"use strict";

const DATA_URL = "data.json";
const REFRESH_INTERVAL_MS = 60000;
let lastDataSignature = "";

const els = {
  headerData: document.getElementById("headerData"),
  lastUpdate: document.getElementById("lastUpdate"),
  content: document.getElementById("content")
};

document.addEventListener("DOMContentLoaded", () => {
  loadData({ forceRender: true });
  window.setInterval(() => loadData({ forceRender: false }), REFRESH_INTERVAL_MS);
});

async function loadData({ forceRender = false } = {}) {
  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`No se pudo leer ${DATA_URL}. HTTP ${response.status}`);

    const data = await response.json();
    const signature = JSON.stringify(data);
    if (!forceRender && signature === lastDataSignature) return;

    lastDataSignature = signature;
    renderDashboard(data);
  } catch (error) {
    console.error(error);
    els.content.innerHTML = `<div class="error">${safe(error.message || "Error al cargar datos")}</div>`;
  }
}

function renderDashboard(data) {
  renderHeader(data);

  if (normalize(data.estado) !== "ACTIVO") {
    els.content.innerHTML = "";
    return;
  }

  const pozos = Array.isArray(data.pozos) ? data.pozos : [];
  const pozosActivos = pozos.filter(pozo => normalize(pozo.estado) === "ACTIVO");

  if (!pozosActivos.length) {
    els.content.innerHTML = `<div class="hidden-state">No hay pozos activos para mostrar.</div>`;
    return;
  }

  els.content.innerHTML = `
    <div class="grid cols-${Math.min(pozosActivos.length, 6)}">
      ${pozosActivos.map(renderWellCard).join("")}
    </div>
  `;
}

function renderHeader(data) {
  const isActive = normalize(data.estado) === "ACTIVO";
  const dotClass = isActive ? "status-dot" : "status-dot status-dot--inactive";
  const padClass = isActive ? "pill" : "pill pill--inactive";

  els.headerData.innerHTML = `
    <span class="pill"><span class="${dotClass}"></span>Equipo: <strong>${safe(data.equipo)}</strong></span>
    <span class="pill">Yacimiento: <strong>${safe(data.yacimiento)}</strong></span>
    <span class="${padClass}">PAD: <strong>${safe(data.pad)}</strong></span>
  `;

  els.lastUpdate.textContent = formatDateTime(data.lastUpdate);
}

function renderWellCard(pozo) {
  const fases = Array.isArray(pozo.fases) ? pozo.fases : [];
  const formaciones = Array.isArray(pozo.formaciones) ? pozo.formaciones : [];

  return `
    <article class="well-card">
      <div class="well-header">
        <div>
          <h2 class="well-name">${safe(pozo.pozo)}</h2>
          <div class="well-type">${safe(pozo.tipo)}</div>
        </div>
        <div class="comment">${safe(pozo.comentarios || "Sin comentario")}</div>
      </div>

      <div class="sections">
        <section class="section">
          <h3 class="section-title">Fases</h3>
          ${renderFasesCards(fases)}
        </section>
        <section class="section">
          <h3 class="section-title">Formaciones</h3>
          ${renderFormacionesTable(formaciones)}
        </section>
      </div>
    </article>
  `;
}

function renderFasesCards(fases) {
  if (!fases.length) return `<div class="empty">Sin fases cargadas</div>`;
  return `
    <div class="phase-cards">
      ${fases.map(fase => `
        <article class="phase-card">
          <h4 class="phase-card-title">${safe(fase.fase)}</h4>
          <div class="phase-grid">
            <div class="metric"><span class="metric-label">Zapato</span><span class="metric-value">${safe(fase.zapato)}</span></div>
            <div class="metric"><span class="metric-label">Prof.</span><span class="metric-value">${safe(fase.profundidad)}</span></div>
            <div class="metric"><span class="metric-label">FIT</span><span class="metric-value">${safe(fase.fit)}</span></div>
            <div class="metric"><span class="metric-label">MW</span><span class="metric-value">${safe(fase.mw)}</span></div>
            <div class="metric"><span class="metric-label">MASP</span><span class="metric-value">${safe(fase.masp)}</span></div>
          </div>
          <div class="phase-note">${safe(fase.comentario || "Sin comentario")}</div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderFormacionesTable(formaciones) {
  if (!formaciones.length) return `<div class="empty">Sin formaciones cargadas</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Formación</th><th class="numeric">MD</th><th class="numeric">TVD</th></tr></thead>
        <tbody>
          ${formaciones.map(formacion => `
            <tr>
              <td><strong>${safe(formacion.formacion)}</strong></td>
              <td class="numeric">${safe(formacion.md)}</td>
              <td class="numeric">${safe(formacion.tvd)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function normalize(value) { return String(value || "").trim().toUpperCase(); }

function safe(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safe(value);
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
