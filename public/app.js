const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const messages = document.querySelector("#messages");
const typingIndicator = document.querySelector("#typing-indicator");
const formError = document.querySelector("#form-error");

let conversationId = null;

function appendMessage(text, sender) {
  const article = document.createElement("article");
  article.className = `message ${sender}-message`;

  if (sender === "assistant") {
    const avatar = document.createElement("span");
    avatar.className = "message-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "R";

    const content = document.createElement("div");
    content.className = "message-content";

    const author = document.createElement("p");
    author.className = "message-author";
    author.textContent = "Río Claro IA";

    const role = document.createElement("span");
    role.textContent = "Asistente virtual";
    author.append(role);

    const messageText = document.createElement("p");
    messageText.className = "message-text";
    messageText.textContent = text;

    content.append(author, messageText);
    article.append(avatar, content);
  } else {
    const messageText = document.createElement("p");
    messageText.className = "message-text";
    messageText.textContent = text;
    article.append(messageText);
  }

  messages.append(article);
  messages.scrollTop = messages.scrollHeight;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = input.value.trim();
  formError.hidden = true;

  if (!message) {
    formError.textContent = "Escribe una consulta antes de enviar.";
    formError.hidden = false;
    input.focus();
    return;
  }

  if (message.length > 2000) {
    formError.textContent = "La consulta no puede superar los 2000 caracteres.";
    formError.hidden = false;
    input.focus();
    return;
  }

  appendMessage(message, "user");
  input.value = "";
  input.style.height = "auto";
  sendButton.disabled = true;
  typingIndicator.hidden = false;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        conversation_id: conversationId,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Error al consultar el agente.");
    }

    conversationId = data.conversation_id;
    appendMessage(
      data.reply || "No se recibió una respuesta del asistente.",
      "assistant",
    );
  } catch (error) {
    console.error("Error del chatbot:", error);
    appendMessage(
      "No fue posible conectar con el asistente de Río Claro. Inténtalo nuevamente.",
      "assistant",
    );
  } finally {
    sendButton.disabled = false;
    typingIndicator.hidden = true;
    input.focus();
  }
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  formError.hidden = true;
});

const invoiceForm = document.querySelector("#invoice-form");
const invoiceFile = document.querySelector("#invoice-file");
const invoiceButton = document.querySelector("#invoice-button");
const invoiceStatus = document.querySelector("#invoice-status");
const invoiceError = document.querySelector("#invoice-error");
const invoiceResult = document.querySelector("#invoice-result");

const invoiceFields = {
  proveedor: document.querySelector("#invoice-vendor"),
  cliente: document.querySelector("#invoice-customer"),
  folio: document.querySelector("#invoice-id"),
  fecha: document.querySelector("#invoice-date"),
  subtotal: document.querySelector("#invoice-subtotal"),
  iva: document.querySelector("#invoice-tax"),
  total: document.querySelector("#invoice-total"),
};

const invoiceValidation = document.querySelector("#invoice-validation");
const invoiceDuplicates = document.querySelector("#invoice-duplicates");
const invoiceWarning = document.querySelector("#invoice-warning");

const moneyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

function mostrarValor(valor) {
  return valor === null || valor === undefined || valor === ""
    ? "No detectado"
    : String(valor);
}

function mostrarImporte(valor) {
  return typeof valor === "number" && Number.isFinite(valor)
    ? moneyFormatter.format(valor)
    : "No detectado";
}

invoiceForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  invoiceError.hidden = true;
  invoiceResult.hidden = true;
  invoiceStatus.textContent = "";

  const archivo = invoiceFile.files?.[0];

  if (!archivo) {
    invoiceError.textContent = "Selecciona una factura PDF.";
    invoiceError.hidden = false;
    return;
  }

  if (
    archivo.type !== "application/pdf" &&
    !archivo.name.toLowerCase().endsWith(".pdf")
  ) {
    invoiceError.textContent = "Solo se permiten archivos PDF.";
    invoiceError.hidden = false;
    return;
  }

  if (archivo.size > 5 * 1024 * 1024) {
    invoiceError.textContent = "El PDF no puede superar los 5 MB.";
    invoiceError.hidden = false;
    return;
  }

  const formData = new FormData();
  formData.append("factura", archivo);

  invoiceButton.disabled = true;
  invoiceButton.textContent = "Analizando...";
  invoiceStatus.textContent =
    "Azure Document Intelligence está procesando la factura.";

  try {
    const response = await fetch("/api/facturas/analizar", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "No fue posible analizar el PDF.");
    }

    const factura = data.factura ?? {};

    invoiceFields.proveedor.textContent = mostrarValor(factura.proveedor);
    invoiceFields.cliente.textContent = mostrarValor(factura.cliente);
    invoiceFields.folio.textContent = mostrarValor(factura.folio);
    invoiceFields.fecha.textContent = mostrarValor(factura.fecha);

    invoiceFields.subtotal.textContent = mostrarImporte(factura.subtotal);
    invoiceFields.iva.textContent = mostrarImporte(factura.iva);
    invoiceFields.total.textContent = mostrarImporte(factura.total);

    const validacion = data.validacion ?? {};

    if (!validacion.importesValidos) {
      invoiceValidation.textContent =
        "No se pudieron validar todos los importes.";
    } else if (validacion.totalCorrecto === true) {
      invoiceValidation.textContent =
        "Los importes coinciden: subtotal + IVA = total.";
    } else {
      invoiceValidation.textContent =
        "Los importes no coinciden. Se requiere revisión.";
    }

    const duplicados = data.duplicados ?? {};

    if (duplicados.posibleDuplicado === true) {
      invoiceDuplicates.textContent =
        "POSIBLE FACTURA DUPLICADA: " + duplicados.mensaje;
    } else if (duplicados.posibleDuplicado === false) {
      invoiceDuplicates.textContent = "" + duplicados.mensaje;
    } else {
      invoiceDuplicates.textContent =
        " " +
        (duplicados.mensaje ||
          "No se pudo verificar si la factura está duplicada.");
    }

    if (duplicados.diferencias?.length > 0) {
      const detalle = duplicados.diferencias
        .map((diferencia) => {
          const pdf = moneyFormatter.format(diferencia.valorPdf);
          const registrado = moneyFormatter.format(diferencia.valorRegistrado);

          return `${diferencia.campo}: PDF ${pdf}, registro ${registrado}`;
        })
        .join("; ");

      invoiceDuplicates.textContent += ` ⚠️ DIFERENCIAS EN IMPORTES: ${detalle}.`;
    }

    invoiceWarning.textContent =
      data.advertencia || "Los resultados requieren revisión humana.";

    invoiceResult.hidden = false;
    invoiceStatus.textContent = "Análisis finalizado.";
  } catch (error) {
    console.error("Error de análisis de factura:", error);
    invoiceError.textContent = error.message;
    invoiceError.hidden = false;
    invoiceStatus.textContent = "No se completó el análisis.";
  } finally {
    invoiceButton.disabled = false;
    invoiceButton.textContent = "Analizar factura PDF";
  }
});

const loginScreen = document.querySelector("#login-screen");
const loginForm = document.querySelector("#login-form");
const loginPassword = document.querySelector("#login-password");
const loginButton = document.querySelector("#login-button");
const loginError = document.querySelector("#login-error");
const mainContent = document.querySelector("#main-content");
const logoutButton = document.querySelector("#logout-button");

function mostrarAplicacion(autenticado) {
  loginScreen.hidden = autenticado;
  mainContent.hidden = !autenticado;
  logoutButton.hidden = !autenticado;
}

async function verificarSesion() {
  try {
    const respuesta = await fetch("/api/session", {
      credentials: "same-origin",
    });

    if (!respuesta.ok) {
      throw new Error("No se pudo verificar la sesión.");
    }

    const datos = await respuesta.json();
    mostrarAplicacion(datos.authenticated === true);
  } catch (error) {
    console.error("Error de sesión:", error);
    mostrarAplicacion(false);
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  loginError.hidden = true;
  loginButton.disabled = true;
  loginButton.textContent = "Verificando...";

  try {
    const respuesta = await fetch("/api/login", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        password: loginPassword.value,
      }),
    });

    const datos = await respuesta.json();

    if (!respuesta.ok) {
      throw new Error(datos.error || "No fue posible iniciar sesión.");
    }

    loginPassword.value = "";
    mostrarAplicacion(true);
  } catch (error) {
    loginError.textContent = error.message;
    loginError.hidden = false;
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "Iniciar sesión";
  }
});

verificarSesion();
logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  logoutButton.textContent = "Cerrando sesión...";

  try {
    const respuesta = await fetch("/api/logout", {
      method: "POST",
      credentials: "same-origin"
    });

    if (!respuesta.ok) {
      throw new Error("No se pudo cerrar la sesión.");
    }

    conversationId = null;
    loginPassword.value = "";
    loginError.hidden = true;

    mostrarAplicacion(false);
  } catch (error) {
    console.error("Error al cerrar sesión:", error);
    alert("No fue posible cerrar la sesión. Inténtalo nuevamente.");
  } finally {
    logoutButton.disabled = false;
    logoutButton.textContent = "Cerrar sesión";
  }
});