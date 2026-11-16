
import { readFile } from "node:fs/promises";
import path from "node:path";

const endpoint = process.env.DOCUMENT_INTELLIGENCE_ENDPOINT;
const apiKey = process.env.DOCUMENT_INTELLIGENCE_KEY;

const archivo = path.join(
  import.meta.dirname,
  "..",
  "documentos",
  "factura-demo-006.pdf"
);

async function main() {
  if (!endpoint || !apiKey) {
    console.error("Faltan las variables de Document Intelligence.");
    process.exitCode = 1;
    return;
  }

  try {
    const pdf = await readFile(archivo);

    console.log("Enviando factura PDF a Azure...");

    const url =
      `${endpoint.replace(/\/$/, "")}` +
      "/documentintelligence/documentModels/" +
      "prebuilt-invoice:analyze?api-version=2024-11-30";

    const respuesta = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
        "Content-Type": "application/pdf"
      },
      body: pdf
    });

    if (respuesta.status !== 202) {
      console.error(
        "Azure rechazó el documento. Código HTTP:",
        respuesta.status
      );
      process.exitCode = 1;
      return;
    }

    const operationUrl = respuesta.headers.get("operation-location");

    if (!operationUrl) {
      throw new Error("Azure no devolvió la ubicación del análisis.");
    }

    console.log("Documento recibido. Esperando el análisis...");

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
          `Error al consultar el análisis: HTTP ${consulta.status}`
        );
      }

      resultado = await consulta.json();

      if (resultado.status === "succeeded") {
        break;
      }

      if (resultado.status === "failed") {
        throw new Error("Azure no pudo analizar el documento.");
      }
    }

    if (resultado?.status !== "succeeded") {
      throw new Error("El análisis excedió el tiempo de espera.");
    }

    const documento = resultado.analyzeResult?.documents?.[0];

    if (!documento) {
      console.log("No se detectó una factura estructurada.");
      return;
    }

    const campos = documento.fields ?? {};

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
      impuestos: obtener("TotalTax"),
      total: obtener("InvoiceTotal")
    };

    console.log("\nFACTURA EXTRAÍDA POR AZURE:");
    console.log(JSON.stringify(factura, null, 2));
  } catch (error) {
    console.error("Error:", error.message);
    process.exitCode = 1;
  }
}

await main();
