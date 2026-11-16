
import path from "node:path";
import express from "express";
import multer from "multer";
import session from "express-session";
import { rateLimit } from "express-rate-limit";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";

const app = express();
const port = Number(process.env.PORT) || 3000;

const demoPassword = process.env.DEMO_ACCESS_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET;
const isProduction = process.env.NODE_ENV === "production";

const agentName = process.env.FOUNDRY_AGENT_NAME;
const projectEndpoint = process.env.FOUNDRY_PROJECT_ENDPOINT;

const publicDirectory = path.join(import.meta.dirname, "public");
const dataFile = path.join(import.meta.dirname, "datos", "empresa.json");
const facturasFile = path.join(import.meta.dirname, "datos", "facturas.json");

if (!demoPassword || !sessionSecret || sessionSecret.length < 32) {
  throw new Error(
    "Falta configurar DEMO_ACCESS_PASSWORD o SESSION_SECRET."
  );
}

if (isProduction) {
  app.set("trust proxy", 1);
}

const sessionMiddleware = session({
  name: "rio_claro_session",
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 2 * 60 * 60 * 1000
  }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "Demasiados intentos. Intenta nuevamente en 15 minutos."
  }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "Demasiadas solicitudes. Espera un momento."
  }
});

const subirFactura = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype !== "application/pdf") {
      callback(new Error("Solo se permiten archivos PDF."));
      return;
    }

    callback(null, true);
  }
});

function passwordMatches(candidate) {
  const supplied = Buffer.from(candidate);
  const expected = Buffer.from(demoPassword);

  return (
    supplied.length === expected.length &&
    timingSafeEqual(supplied, expected)
  );
}

function requireLogin(request, response, next) {
  if (request.session?.authenticated === true) {
    next();
    return;
  }

  response.status(401).json({
    error: "Debes iniciar sesión para utilizar Río Claro IA."
  });
}

function normalizarTexto(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

async function obtenerDatosEmpresa() {
  const contenido = await readFile(dataFile, "utf8");
  return JSON.parse(contenido);
}

async function analizarFacturas() {
  const contenido = await readFile(facturasFile, "utf8");
  const datos = JSON.parse(contenido);

  const facturas = datos.facturas;
  const incidencias = [];
  const facturasVistas = new Map();

  for (const factura of facturas) {
    const clave = JSON.stringify([
      normalizarTexto(factura.proveedor),
      normalizarTexto(factura.folio)
    ]);

    if (facturasVistas.has(clave)) {
      incidencias.push({
        tipo: "POSIBLE_DUPLICADO",
        folio: factura.folio,
        proveedor: factura.proveedor,
        descripcion:
          "El folio aparece más de una vez para el mismo proveedor.",
        requiereRevisionHumana: true
      });
    } else {
      facturasVistas.set(clave, factura);
    }

    const campos = [
      "folio",
      "proveedor",
      "fecha",
      "subtotal",
      "iva",
      "total"
    ];

    const faltantes = campos.filter(
      (campo) =>
        factura[campo] === undefined ||
        factura[campo] === null ||
        factura[campo] === ""
    );

    if (faltantes.length > 0) {
      incidencias.push({
        tipo: "CAMPOS_FALTANTES",
        folio: factura.folio ?? "Sin folio",
        descripcion: `Faltan: ${faltantes.join(", ")}`,
        requiereRevisionHumana: true
      });
      continue;
    }

    const importes = [
      factura.subtotal,
      factura.iva,
      factura.total
    ];

    if (
      importes.some(
        (valor) =>
          typeof valor !== "number" ||
          !Number.isFinite(valor) ||
          valor < 0
      )
    ) {
      incidencias.push({
        tipo: "IMPORTE_INVALIDO",
        folio: factura.folio,
        descripcion: "Hay importes inválidos.",
        requiereRevisionHumana: true
      });
      continue;
    }

    const subtotal = Math.round(factura.subtotal * 100);
    const iva = Math.round(factura.iva * 100);
    const total = Math.round(factura.total * 100);

    if (subtotal + iva !== total) {
      incidencias.push({
        tipo: "TOTAL_INCORRECTO",
        folio: factura.folio,
        proveedor: factura.proveedor,
        totalRegistrado: factura.total,
        totalCalculado: (subtotal + iva) / 100,
        requiereRevisionHumana: true
      });
    }
  }

  return {
    tipoDatos: "Facturas ficticias de demostración",
    facturasAnalizadas: facturas.length,
    incidenciasDetectadas: incidencias.length,
    incidencias,
    advertencia:
      "Las incidencias requieren revisión humana. No se aprueban ni ejecutan pagos."
  };
}

async function buscarFacturaDuplicada(facturaExtraida) {
  const contenido = await readFile(facturasFile, "utf8");
  const datos = JSON.parse(contenido);

  const proveedor = normalizarTexto(facturaExtraida.proveedor);
  const folio = normalizarTexto(facturaExtraida.folio);

  if (!proveedor || !folio) {
    return {
      posibleDuplicado: null,
      coincidencias: 0,
      diferencias: [],
      importesCoincidenConRegistros: null,
      mensaje:
        "No se pudo comprobar si está duplicada porque falta el proveedor o el folio."
    };
  }

  const coincidencias = datos.facturas.filter(
    (registrada) =>
      normalizarTexto(registrada.proveedor) === proveedor &&
      normalizarTexto(registrada.folio) === folio
  );

  const diferencias = [];

  const camposImporte = [
    ["subtotal", "subtotal"],
    ["iva", "iva"],
    ["total", "total"]
  ];

  for (const registrada of coincidencias) {
    for (const [campoPdf, campoRegistro] of camposImporte) {
      const valorPdf = facturaExtraida[campoPdf];
      const valorRegistrado = registrada[campoRegistro];

      if (
        typeof valorPdf === "number" &&
        Number.isFinite(valorPdf) &&
        typeof valorRegistrado === "number" &&
        Number.isFinite(valorRegistrado) &&
        Math.round(valorPdf * 100) !==
          Math.round(valorRegistrado * 100)
      ) {
        diferencias.push({
          campo: campoPdf,
          valorPdf,
          valorRegistrado
        });
      }
    }
  }

  return {
    posibleDuplicado: coincidencias.length > 0,
    coincidencias: coincidencias.length,
    diferencias,
    importesCoincidenConRegistros:
      coincidencias.length === 0
        ? null
        : diferencias.length === 0,
    mensaje:
      coincidencias.length > 0
        ? "Se encontró una factura con el mismo proveedor y folio. Requiere revisión humana."
        : "No se encontraron coincidencias en los registros ficticios."
  };
}

const foundryConfigured = Boolean(agentName && projectEndpoint);

let openAIClient;

function logFoundryFailure(error) {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown Foundry error.";

  let safeMessage = message;

  if (projectEndpoint) {
    safeMessage = safeMessage.replaceAll(
      projectEndpoint,
      "[project endpoint]"
    );
  }

  if (agentName) {
    safeMessage = safeMessage.replaceAll(
      agentName,
      "[agent name]"
    );
  }

  safeMessage = safeMessage
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[token redacted]"
    )
    .slice(0, 500);

  console.error("Foundry request failed", {
    name: error?.name,
    code: error?.code,
    statusCode: error?.statusCode ?? error?.status,
    message: safeMessage
  });
}

if (foundryConfigured) {
  const projectClient = new AIProjectClient(
    projectEndpoint,
    new DefaultAzureCredential()
  );

  openAIClient = projectClient.getOpenAIClient();
}

app.use(express.json({ limit: "16kb" }));
app.use(sessionMiddleware);

app.use("/api", apiLimiter);

app.use(express.static(publicDirectory));

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/api/session", (request, response) => {
  response.json({
    authenticated: request.session?.authenticated === true
  });
});

app.post("/api/login", loginLimiter, (request, response) => {
  const password = request.body?.password;

  if (typeof password !== "string" || password.length > 200) {
    response.status(400).json({
      error: "Contraseña no válida."
    });
    return;
  }

  if (!passwordMatches(password)) {
    response.status(401).json({
      error: "Contraseña incorrecta."
    });
    return;
  }

  request.session.regenerate((error) => {
    if (error) {
      response.status(500).json({
        error: "No fue posible iniciar sesión."
      });
      return;
    }

    request.session.authenticated = true;

    request.session.save((saveError) => {
      if (saveError) {
        response.status(500).json({
          error: "No fue posible guardar la sesión."
        });
        return;
      }

      response.json({
        authenticated: true
      });
    });
  });
});

app.post("/api/logout", requireLogin, (request, response) => {
  request.session.destroy((error) => {
    if (error) {
      response.status(500).json({
        error: "No fue posible cerrar sesión."
      });
      return;
    }

    response.clearCookie("rio_claro_session");

    response.json({
      authenticated: false
    });
  });
});

app.post(
  "/api/facturas/analizar",
  requireLogin,
  subirFactura.single("factura"),
  async (request, response) => {
    if (!request.file) {
      response.status(400).json({
        error: "Debes seleccionar una factura PDF."
      });
      return;
    }

    const pdf = request.file.buffer;

    if (pdf.subarray(0, 5).toString() !== "%PDF-") {
      response.status(400).json({
        error: "El archivo no parece ser un PDF válido."
      });
      return;
    }

    const endpoint = process.env.DOCUMENT_INTELLIGENCE_ENDPOINT;
    const apiKey = process.env.DOCUMENT_INTELLIGENCE_KEY;

    if (!endpoint || !apiKey) {
      response.status(503).json({
        error: "Document Intelligence no está configurado."
      });
      return;
    }

    try {
      const url =
        `${endpoint.replace(/\/$/, "")}` +
        "/documentintelligence/documentModels/" +
        "prebuilt-invoice:analyze?api-version=2024-11-30";

      const azureResponse = await fetch(url, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": apiKey,
          "Content-Type": "application/pdf"
        },
        body: pdf
      });

      if (azureResponse.status !== 202) {
        throw new Error(
          `Azure rechazó el documento: HTTP ${azureResponse.status}`
        );
      }

      const operationUrl = azureResponse.headers.get(
        "operation-location"
      );

      if (!operationUrl) {
        throw new Error("Azure no devolvió la operación.");
      }

      let resultado;

      for (let intento = 0; intento < 30; intento++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const consulta = await fetch(operationUrl, {
          headers: {
            "Ocp-Apim-Subscription-Key": apiKey
          }
        });

        if (!consulta.ok) {
          throw new Error(
            `Error HTTP ${consulta.status}`
          );
        }

        resultado = await consulta.json();

        if (resultado.status === "succeeded") {
          break;
        }

        if (resultado.status === "failed") {
          throw new Error(
            "Azure no pudo analizar la factura."
          );
        }
      }

      if (resultado?.status !== "succeeded") {
        throw new Error(
          "Tiempo de espera agotado."
        );
      }

      const campos =
        resultado.analyzeResult?.documents?.[0]?.fields;

      if (!campos) {
        response.status(422).json({
          error: "No se identificaron campos de factura."
        });
        return;
      }

      const obtener = (nombre) => {
        const campo = campos[nombre];

        return (
          campo?.valueString ??
          campo?.valueDate ??
          campo?.valueCurrency?.amount ??
          campo?.content ??
          null
        );
      };

      const factura = {
        proveedor: obtener("VendorName"),
        cliente: obtener("CustomerName"),
        folio: obtener("InvoiceId"),
        fecha: obtener("InvoiceDate"),
        subtotal: obtener("SubTotal"),
        iva: obtener("TotalTax"),
        total: obtener("InvoiceTotal")
      };

      const importes = [
        factura.subtotal,
        factura.iva,
        factura.total
      ];

      const importesValidos = importes.every(
        (valor) =>
          typeof valor === "number" &&
          Number.isFinite(valor) &&
          valor >= 0
      );

      const totalCorrecto = importesValidos
        ? Math.round(factura.subtotal * 100) +
            Math.round(factura.iva * 100) ===
          Math.round(factura.total * 100)
        : null;

      const duplicados = await buscarFacturaDuplicada(factura);

      response.json({
        mensaje: "Factura procesada correctamente.",
        factura,
        validacion: {
          importesValidos,
          totalCorrecto,
          requiereRevisionHumana: true
        },
        duplicados,
        advertencia:
          "Extracción automática para demostración. Los datos deben revisarse antes de cualquier operación administrativa."
      });
    } catch (error) {
      console.error(
        "Error al analizar factura:",
        error.message
      );

      response.status(502).json({
        error: "No fue posible analizar la factura con Azure."
      });
    }
  }
);

app.post("/api/chat", requireLogin, async (request, response) => {
  const message =
    typeof request.body?.message === "string"
      ? request.body.message.trim()
      : "";

  if (!message || message.length > 2000) {
    response.status(422).json({
      error: "El mensaje debe tener entre 1 y 2000 caracteres."
    });
    return;
  }

  const suppliedConversationId = request.body?.conversation_id;

  if (
    suppliedConversationId != null &&
    typeof suppliedConversationId !== "string"
  ) {
    response.status(422).json({
      error: "El identificador de conversación no es válido."
    });
    return;
  }

  if (!openAIClient) {
    response.status(502).json({
      error: "No fue posible procesar la solicitud de chat."
    });
    return;
  }

  try {
    const conversationId =
      suppliedConversationId?.trim() ||
      (await openAIClient.conversations.create()).id;

    const datosEmpresa = await obtenerDatosEmpresa();
    const analisisFacturas = await analizarFacturas();

    const contextoEmpresa = `
DATOS AUTORIZADOS DE DEMOSTRACIÓN DE DISTRIBUIDORA RÍO CLARO
Estos datos son ficticios y únicamente sirven para el proyecto académico.
No representan información empresarial en tiempo real.

PRODUCTOS:
${JSON.stringify(datosEmpresa.productos)}

INVENTARIO:
${JSON.stringify(datosEmpresa.inventario)}

PEDIDOS:
${JSON.stringify(datosEmpresa.pedidos)}

POLÍTICAS:
${JSON.stringify(datosEmpresa.politicas)}

ANÁLISIS AUTOMÁTICO DE FACTURAS:
${JSON.stringify(analisisFacturas)}

REGLAS PARA FACTURAS:
- Utiliza los resultados calculados por JavaScript.
- Identifica las facturas duplicadas.
- Explica los errores en los importes.
- No inventes facturas ni cantidades.
- Nunca apruebes ni ejecutes pagos.
- Recomienda revisión humana.
- Aclara que son datos ficticios de demostración.

INSTRUCCIONES PARA ESTA CONSULTA:
- Usa estos datos exclusivamente para responder preguntas relacionadas con ellos.
- Identifica el producto por su código cuando relaciones productos e inventario.
- No inventes existencias, precios, pedidos ni sucursales.
- Si la información no está disponible, indícalo.
- Aclara que los resultados son datos ficticios de demostración.
- No afirmes que los datos son actuales o que provienen de un sistema ERP.
`;

    const mensajeConContexto = `
${contextoEmpresa}

CONSULTA DEL USUARIO:
${message}
`;

    const result = await openAIClient.responses.create(
      {
        conversation: conversationId,
        input: mensajeConContexto
      },
      {
        body: {
          agent_reference: {
            name: agentName,
            type: "agent_reference"
          }
        }
      }
    );

    response.json({
      reply: result.output_text,
      conversation_id: conversationId
    });
  } catch (error) {
    logFoundryFailure(error);

    response.status(502).json({
      error: "No fue posible procesar la solicitud de chat."
    });
  }
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    response.status(400).json({
      error:
        "El archivo supera el límite de 5 MB o la carga no es válida."
    });
    return;
  }

  if (error.message === "Solo se permiten archivos PDF.") {
    response.status(400).json({
      error: error.message
    });
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json({
      error:
        "El cuerpo de la solicitud no contiene JSON válido."
    });
    return;
  }

  console.error("Error interno:", error.name);

  response.status(500).json({
    error: "Ocurrió un error interno."
  });
});

app.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}.`);
});
