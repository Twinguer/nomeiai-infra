import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";

export const PCI_URL = "https://www.pciconcursos.com.br/concursos/";

const H2_TO_REGIAO: [RegExp, string][] = [
  [/NACIONAL/i, "NACIONAL"],
  [/REGIÃO\s+SUDESTE/i, "SUDESTE"],
  [/REGIÃO\s+SUL/i, "SUL"],
  [/REGIÃO\s+CENTRO-?OESTE/i, "CENTRO-OESTE"],
  [/REGIÃO\s+NORDESTE/i, "NORDESTE"],
  [/REGIÃO\s+NORTE/i, "NORTE"],
];

export interface PciParsedItem {
  id: string;
  titulo: string;
  regiao: string;
  uf?: string;
  vagas: number | null;
  vagas_texto: string | null;
  salario_min: number | null;
  salario_max: number | null;
  salario_texto: string;
  cargos: string;
  escolaridade: string;
  resumo: string;
  inscricao_ate: string;
  inscricao_texto: string;
  status: string;
}

function normalizeText(s: string | null | undefined): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

function mapH2ToRegiao(text: string): string | null {
  const t = normalizeText(text);
  for (const [re, regiao] of H2_TO_REGIAO) {
    if (re.test(t)) return regiao;
  }
  return null;
}

function slugId(
  titulo: string,
  regiao: string,
  uf: string | undefined,
  inscricao: string,
  escolaridade: string,
  resumo: string,
): string {
  return [titulo, regiao, uf || "", inscricao, escolaridade || "", resumo || ""]
    .join("-")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function parseVagas(text: string): number | null {
  const m = text.match(/([\d.]+)\s*vagas/i);
  if (m) return parseInt(m[1].replace(/\./g, ""), 10);
  return null;
}

function parseSalario(text: string) {
  const ate = text.match(/até\s*R\$\s*([\d.,]+)/i);
  if (ate) {
    const val = parseFloat(ate[1].replace(/\./g, "").replace(",", "."));
    return { min: null as number | null, max: val, texto: `até R$ ${ate[1]}` };
  }
  const range = text.match(/R\$\s*([\d.,]+)\s*a\s*R\$\s*([\d.,]+)/i);
  if (range) {
    const toNum = (s: string) => parseFloat(s.replace(/\./g, "").replace(",", "."));
    return { min: toNum(range[1]), max: toNum(range[2]), texto: `R$ ${range[1]} a R$ ${range[2]}` };
  }
  return { min: null, max: null, texto: "" };
}

function firstDirectChild(el: Element, tagName: string): Element | null {
  for (const child of Array.from(el.children)) {
    if (child.tagName === tagName) return child;
  }
  return null;
}

function parseCd(cdEl: Element | null) {
  const full = normalizeText(cdEl?.textContent || "");
  const outerSpan = cdEl ? firstDirectChild(cdEl, "SPAN") : null;
  const innerSpan = outerSpan ? firstDirectChild(outerSpan, "SPAN") : null;
  const escolaridade = normalizeText(innerSpan?.textContent || "");
  let cargos = "";
  if (outerSpan) {
    const parts: string[] = [];
    for (const node of Array.from(outerSpan.childNodes)) {
      if (node.nodeName === "SPAN") break;
      if (node.nodeType === 3) parts.push(node.textContent || "");
      if (node.nodeName === "BR") parts.push(" ");
    }
    cargos = normalizeText(parts.join(""));
  }
  let line1 = full;
  if (outerSpan) {
    const idx = full.indexOf(normalizeText(outerSpan.textContent || ""));
    if (idx > 0) line1 = full.slice(0, idx).trim();
  }
  const { min, max, texto } = parseSalario(line1 || full);
  return {
    vagas: parseVagas(full),
    vagas_texto: /cadastro de reserva/i.test(full) ? "Cadastro de reserva" : null,
    salario_min: min,
    salario_max: max,
    salario_texto: texto,
    cargos: cargos || "—",
    escolaridade: escolaridade || "—",
    resumo: line1 || full.slice(0, 120),
  };
}

function parseInscricao(ceEl: Element | null) {
  const raw = normalizeText((ceEl?.textContent || "").replace(/\s*a\s*/i, " a "));
  const dates = raw.match(/\d{2}\/\d{2}\/\d{4}/g) || [];
  return {
    inscricao_ate: dates[dates.length - 1] || raw,
    inscricao_texto: raw,
    status: "aberto",
  };
}

export function parsePciConcursosHtml(html: string): PciParsedItem[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const center = doc.querySelector("#center") || doc.body;

  let regiao: string | null = null;
  let ufEstado: string | null = null;
  const items: PciParsedItem[] = [];

  const nodes = center.querySelectorAll("h2, div.ua, div.da, div.na");
  for (const node of nodes) {
    if (node.tagName === "H2") {
      const mapped = mapH2ToRegiao(node.textContent || "");
      if (mapped) {
        regiao = mapped;
        ufEstado = null;
      }
      continue;
    }

    if (node.classList.contains("ua")) {
      ufEstado = node.id && node.id.length <= 3 ? node.id : null;
      const ufDiv = node.querySelector(".uf");
      if (!ufEstado && ufDiv) {
        const nome = normalizeText(ufDiv.textContent || "");
        if (nome === "NACIONAL") ufEstado = null;
      }
      continue;
    }

    if (!regiao) continue;
    if (!node.classList.contains("da") && !node.classList.contains("na")) continue;

    const tituloEl = node.querySelector(".ca a");
    if (!tituloEl) continue;

    const titulo = normalizeText(tituloEl.textContent);
    if (!titulo) continue;

    const cc = normalizeText(node.querySelector(".cc")?.textContent || "");
    const uf =
      cc && cc.length <= 3 && cc !== "\u00a0"
        ? cc
        : regiao === "NACIONAL"
          ? undefined
          : ufEstado || undefined;

    const cd = parseCd(node.querySelector(".cd"));
    const insc = parseInscricao(node.querySelector(".ce"));

    items.push({
      id: slugId(titulo, regiao, uf, insc.inscricao_ate, cd.escolaridade, cd.resumo),
      titulo,
      regiao,
      uf,
      ...cd,
      ...insc,
    });
  }

  return items;
}

export async function fetchPciConcursosHtml(): Promise<string> {
  const res = await fetch(PCI_URL, {
    headers: {
      "User-Agent": "NomeiaAi/1.0 (+sync-pci-concursos)",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`PCI respondeu ${res.status}`);
  return res.text();
}
