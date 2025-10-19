/*
 * Archivo principal de JavaScript para el dashboard de pozos.
 * Se encarga de leer el JSON con los datos de los pozos, construir
 * dinámicamente las tarjetas KPI, tablas y controles de selección,
 * así como gestionar los eventos de tema oscuro, auto desplazamiento
 * y cambios en los datos.
 */

// Mantendrá la data actual para detectar cambios.
let currentData = null;
// Lista de nombres de pozos que el usuario ha ocultado; se almacena en localStorage
let hiddenWellNames = [];
// Lista de ítems de stock que el usuario ha ocultado; se almacena en localStorage
let hiddenStockItems = [];
// Mapeará los datos de auto-scroll por tabla (interval y listener)
const autoScrollData = new Map();

// Colores por defecto para los pozos (para colorear cabeceras).
// Orden: pozo 1..6. Amarillo, verde, azul, rojo, blanco y gris.
const defaultWellColors = ['#ffd83a', '#7ad39a', '#74b3ff', '#ff7b7b', '#ffffff', '#cccccc'];
// Array de colores que se pueden personalizar por el usuario; se cargan desde localStorage
let wellColors = defaultWellColors.slice();

/**
 * Obtiene el desplazamiento vertical deseado para mostrar la última fila
 * con datos (fecha/hora o profundidad) en la tabla contenida en el elemento
 * dado. Si no se encuentran filas con datos, se devuelve 0.
 * @param {HTMLElement} inner Contenedor con overflow de la tabla
 * @returns {number} Valor de scrollTop a aplicar
 */
function getLastDataScroll(inner) {
  const table = inner.querySelector('table');
  if (!table) return 0;
  const rows = table.querySelectorAll('tbody tr');
  let targetRow = null;
  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    for (let i = 1; i < cells.length; i++) {
      const mod = i % 3;
      if (mod === 1 || mod === 2) {
        if (cells[i].textContent && cells[i].textContent.trim() !== '') {
          targetRow = row;
        }
      }
    }
  });
  if (targetRow) {
    const rowTop = targetRow.offsetTop;
    const rowHeight = targetRow.offsetHeight;
    const desired = rowTop + rowHeight - inner.clientHeight;
    return Math.max(0, desired);
  }
  return 0;
}

/** Normaliza distintos valores que pueden enviar mandos/TVs para representar
 * flechas y teclas de navegación. Devuelve uno de: 'ArrowLeft','ArrowRight',
 * 'ArrowUp','ArrowDown','PageUp','PageDown','Home','End' o el valor original
 * de ev.key si no se reconoce.
 */
function normalizeKey(ev) {
  const raw = (ev.key || '').toString();
  const code = (ev.code || '').toString();
  const kc = ev.keyCode || ev.which || 0;
  // Mapeo directo de variantes conocidas
  const map = {
    'Left': 'ArrowLeft', 'Right': 'ArrowRight', 'Up': 'ArrowUp', 'Down': 'ArrowDown',
    'ArrowLeft': 'ArrowLeft', 'ArrowRight': 'ArrowRight', 'ArrowUp': 'ArrowUp', 'ArrowDown': 'ArrowDown',
    'PageUp': 'PageUp', 'PageDown': 'PageDown', 'Home': 'Home', 'End': 'End'
  };
  if (map[raw]) return map[raw];
  if (map[code]) return map[code];
  // keyCode fallbacks
  if (kc === 37) return 'ArrowLeft';
  if (kc === 39) return 'ArrowRight';
  if (kc === 38) return 'ArrowUp';
  if (kc === 40) return 'ArrowDown';
  if (kc === 33) return 'PageUp';
  if (kc === 34) return 'PageDown';
  if (kc === 36) return 'Home';
  if (kc === 35) return 'End';
  return raw || code || String(kc);
}

/** Devuelve el elemento que debe recibir scroll horizontal (el que tiene overflow)
 * Busca `#tables-wrapper` primero y luego otros candidatos. Retorna null si no lo encuentra.
 */
function findHorizontalScroller() {
  try {
    const wrapper = document.getElementById('tables-wrapper');
    if (wrapper && wrapper.scrollWidth > wrapper.clientWidth) return wrapper;
    // Buscar contenedores internos que puedan tener overflow
    const candidates = Array.from(document.querySelectorAll('.table-container, .table-wrapper-inner, table'));
    for (let el of candidates) {
      if (!el) continue;
      if (el.scrollWidth > el.clientWidth) return el;
      const style = window.getComputedStyle(el);
      if (style && (style.overflowX === 'auto' || style.overflowX === 'scroll')) return el;
    }
    return wrapper || null;
  } catch (e) {
    return null;
  }
}

/**
 * Al cargar el contenido del documento, configuramos los eventos
 * iniciales y solicitamos los datos.
 */
document.addEventListener('DOMContentLoaded', () => {
  // Detectar si estamos en una TV (mejor compatibilidad con mandos/firmwares)
  try {
    var _UA = navigator.userAgent || '';
    var _IS_TV = /\b(Android TV|SMART-TV|HBBTV|BRAVIA|AFT|MiBOX|TCL)\b/i.test(_UA) || /com\.tcl\.browser/i.test(_UA);
    if (_IS_TV) document.documentElement.classList.add('is-tv');
  } catch (e) {}
  // Cargar la lista de pozos ocultos desde localStorage
  try {
    const storedHidden = localStorage.getItem('hiddenWellNames');
    hiddenWellNames = storedHidden ? JSON.parse(storedHidden) : [];
  } catch (e) {
    hiddenWellNames = [];
  }
  // Cargar la lista de ítems de stock ocultos desde localStorage
  try {
    const storedStockHidden = localStorage.getItem('hiddenStockItems');
    hiddenStockItems = storedStockHidden ? JSON.parse(storedStockHidden) : [];
  } catch (e) {
    hiddenStockItems = [];
  }

  // Cargar colores de pozos desde localStorage o usar por defecto
  try {
    const storedColors = localStorage.getItem('wellColors');
    if (storedColors) {
      const parsed = JSON.parse(storedColors);
      if (Array.isArray(parsed) && parsed.length >= defaultWellColors.length) {
        wellColors = parsed.slice(0, defaultWellColors.length);
      }
    }
  } catch (e) {
    wellColors = defaultWellColors.slice();
  }
  // Configurar el toggle de tema oscuro/claro
  const themeToggle = document.getElementById('themeToggle');
  // Determinar tema preferido almacenado; si no existe, usar oscuro por defecto
  let storedTheme;
  try {
    storedTheme = localStorage.getItem('theme');
  } catch (e) {
    storedTheme = null;
  }
  if (storedTheme === 'light') {
    // Aplicar tema claro guardado
    document.body.classList.remove('dark');
    themeToggle.checked = false;
  } else {
    // Usar tema oscuro por defecto
    document.body.classList.add('dark');
    themeToggle.checked = true;
    // Guardar la preferencia solo si no existe
    if (!storedTheme) {
      try { localStorage.setItem('theme', 'dark'); } catch (e) {}
    }
  }
  // Permitir cambiar entre modo oscuro y claro; actualizar localStorage
  themeToggle.addEventListener('change', () => {
    if (themeToggle.checked) {
      // Activar modo oscuro
      document.body.classList.add('dark');
      try { localStorage.setItem('theme', 'dark'); } catch (e) {}
    } else {
      // Activar modo claro: simplemente quitar la clase dark
      document.body.classList.remove('dark');
      try { localStorage.setItem('theme', 'light'); } catch (e) {}
    }
  });

  // Configurar el botón de configuración para abrir el modal
  const settingsButton = document.getElementById('settingsButton');
  const settingsModal = document.getElementById('settingsModal');
  const closeSettings = document.getElementById('closeSettings');
  const modalAutoScrollToggle = document.getElementById('modalAutoScrollToggle');
  const autoScrollToggle = document.getElementById('autoScrollToggle');
  settingsButton.addEventListener('click', () => {
    settingsModal.classList.add('show');
    settingsModal.setAttribute('aria-hidden', 'false');
    // Sincronizar estado de auto-scroll entre modal y control oculto
    if (modalAutoScrollToggle) {
      modalAutoScrollToggle.checked = autoScrollToggle.checked;
    }
  });
  closeSettings.addEventListener('click', () => {
    settingsModal.classList.remove('show');
    settingsModal.setAttribute('aria-hidden', 'true');
  });
  // Cerrar modal al hacer clic fuera del contenido
  settingsModal.addEventListener('click', (ev) => {
    if (ev.target === settingsModal) {
      settingsModal.classList.remove('show');
      settingsModal.setAttribute('aria-hidden', 'true');
    }
  });
  // Configurar el toggle de auto-scroll dentro del modal
  modalAutoScrollToggle.addEventListener('change', () => {
    autoScrollToggle.checked = modalAutoScrollToggle.checked;
    if (modalAutoScrollToggle.checked) {
      enableAutoScroll();
    } else {
      disableAutoScroll();
    }
    try { localStorage.setItem('autoScroll', modalAutoScrollToggle.checked ? 'true' : 'false'); } catch (e) {}
  });

  // Leer preferencia persistida de auto-scroll. Por defecto: ACTIVADO.
  try {
    const storedAuto = localStorage.getItem('autoScroll');
    if (storedAuto === 'false') {
      if (autoScrollToggle) autoScrollToggle.checked = false;
    } else {
      // Si no hay preferencia o está en true, activar auto-scroll por defecto
      if (autoScrollToggle) autoScrollToggle.checked = true;
      try { localStorage.setItem('autoScroll', 'true'); } catch (e) {}
    }
    // Sincronizar el toggle del modal si existe
    if (modalAutoScrollToggle && autoScrollToggle) {
      modalAutoScrollToggle.checked = autoScrollToggle.checked;
    }
  } catch (e) {
    if (autoScrollToggle) autoScrollToggle.checked = true;
  }

  // Configurar botones de acciones en el modal
  const resetBtn = document.getElementById('resetSettings');
  const saveBtn = document.getElementById('saveSettings');
  const settingsModalEl = document.getElementById('settingsModal');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      // Restablecer lista de pozos ocultos
      hiddenWellNames = [];
      try {
        localStorage.setItem('hiddenWellNames', JSON.stringify(hiddenWellNames));
      } catch (e) {}
      // Mostrar todas las celdas de pozos
      document.querySelectorAll('[data-well-name]').forEach(cell => {
        cell.style.display = '';
      });
      // Actualizar checkboxes del modal
      document.querySelectorAll('#modalWellControls input[type="checkbox"]').forEach(cb => {
        cb.checked = true;
      });
      // Recalcular ancho mínimo de la tabla
      try { updateTableMinWidth(); } catch (e) {}
      // Desactivar auto desplazamiento
  modalAutoScrollToggle.checked = false;
  autoScrollToggle.checked = false;
  disableAutoScroll();
  try { localStorage.setItem('autoScroll', 'false'); } catch (e) {}

      // Restablecer colores de pozos a valores por defecto
      wellColors = defaultWellColors.slice();
      try { localStorage.setItem('wellColors', JSON.stringify(wellColors)); } catch (e) {}
      applyWellColors();
      // Actualizar controles de colores en el modal
      renderColorControls(currentData || { wells: [] });
    });
  }
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      // Cerrar modal al guardar
      if (settingsModalEl) {
        settingsModalEl.classList.remove('show');
        settingsModalEl.setAttribute('aria-hidden', 'true');
      }
    });
  }

  // Cargar datos iniciales
  fetchData();
  // Revisar datos cada minuto para detectar cambios en el JSON
  setInterval(() => fetchData(true), 60000);

  // Ajustar la altura de las tablas al tamaño de la ventana inicialmente y
  // cuando la ventana cambie de tamaño
  window.addEventListener('resize', adjustTableHeight);

  // overlay de depuración eliminado (se quitó tras la verificación en TV)
});

/**
 * Obtiene el JSON de datos. Si se llama como actualización,
 * solo refresca la interfaz si los datos cambiaron.
 * @param {boolean} isUpdate Indica si es un chequeo de actualización.
 */
function fetchData(isUpdate = false) {
  // Determinar la URL del JSON. Si estamos sirviendo desde archivo (file://), no
  // podemos añadir parámetros de consulta porque los sistemas de archivos
  // interpretan la ruta literalmente. En servidores HTTP agregamos un timestamp
  // para evitar el cache.
  const isFileProtocol = window.location.protocol === 'file:';
  // Usar ruta relativa explícita con ./ para que funcione tanto en directorio raíz como en subcarpetas
  const dataUrl = isFileProtocol ? './data.json' : './data.json?ts=' + Date.now();
  fetch(dataUrl, { cache: 'no-store' })
    .then(resp => resp.json())
    .then(data => {
      if (!isUpdate || !currentData || JSON.stringify(data) !== JSON.stringify(currentData)) {
        currentData = data;
        updateDashboard(data);
      }
    })
    .catch(err => {
      console.error('No se pudieron cargar los datos.', err);
      // Mostrar mensaje de error en la interfaz
      const errorDiv = document.getElementById('error');
      if (errorDiv) {
        errorDiv.textContent = 'No se pudieron cargar los datos JSON. Si estás abriendo el archivo localmente, utiliza un servidor web como python -m http.server para evitar bloqueos del navegador.';
        errorDiv.hidden = false;
      }
    });
}

/**
 * Renderiza todas las partes del dashboard de acuerdo a los datos
 * proporcionados.
 * @param {object} data Objeto con información de pozos y metadatos.
 */
function updateDashboard(data) {
  // Ocultar mensaje de error al actualizar la vista
  const errorDiv = document.getElementById('error');
  if (errorDiv) {
    errorDiv.hidden = true;
    errorDiv.textContent = '';
  }
  // Estructurar los datos para obtener la propiedad wells a partir de items
  const structured = parseWellsFromData(data);
  // Insertar la propiedad wells en data para compatibilidad con funciones existentes
  data.wells = structured.wells;
  // Llenar la interfaz
  populateKpi(data);
  renderWellControls(data);
  renderTables(data);
  updateFooter(data);
  // Actualizar controles del modal
  renderModalControls(data);
  renderStockControls(data);
  // Aplicar estado de ocultación de pozos (mantener ocultos los pozos que el usuario desactivó)
  applyHiddenWellState(data);
  // Actualizar controles de colores y aplicar colores a las cabeceras
  renderColorControls(data);
  applyWellColors();
  // Ajustar la altura de las tablas al espacio disponible
  adjustTableHeight();
  // Si el auto-scroll estaba activado, reiniciar intervalos para que
  // se apliquen a las nuevas tablas.
  const autoScrollToggle = document.getElementById('autoScrollToggle');
  // Sincronizar con preferencia persistida si existe
  try {
    const storedAuto = localStorage.getItem('autoScroll');
    if (storedAuto === 'false') {
      if (autoScrollToggle) autoScrollToggle.checked = false;
    } else if (storedAuto === 'true') {
      if (autoScrollToggle) autoScrollToggle.checked = true;
    }
  } catch (e) {}
  // Posicionar las tablas según estado de auto-scroll:
  // - Si el auto-scroll está activo, usar la estrategia "TV-friendly" (scrollToLastWithData)
  // - Si no, realizar un scroll inmediato al final
  if (autoScrollToggle && autoScrollToggle.checked) {
    scrollToLastWithData(7);
  } else {
    scrollTablesToBottom();
  }
  if (autoScrollToggle && autoScrollToggle.checked) {
    enableAutoScroll();
  } else {
    disableAutoScroll();
  }
}

/**
 * Crea tarjetas KPI en el encabezado basadas en las métricas calculadas a partir
 * de los datos de los pozos.
 * @param {object} data Objeto de datos.
 */
function populateKpi(data) {
  // Ahora las KPIs principales (Pozos, Etapas, etc.) se renderizan en el footer
  const footer = document.getElementById('footer');
  const footerContent = document.getElementById('footerContent');
  if (!footerContent) return;
  footerContent.innerHTML = '';
  if (!data || !Array.isArray(data.wells)) return;
  // Número de pozos
  const wellsCount = data.wells.length;
  // Calcular profundidad promedio considerando solo valores numéricos
  let totalDepth = 0;
  let depthCount = 0;
  // Total de etapas realizadas (fecha de fractura presente)
  let totalStagesPerformed = 0;
  // Agrupar etapas por día de fractura usando la fecha canónica fechaFracturaDate
  const stagesPerDay = {};
  data.wells.forEach(well => {
    well.etapas.forEach(etapa => {
      // Profundidad
      if (typeof etapa.profundidad === 'number') {
        totalDepth += etapa.profundidad;
        depthCount++;
      }
      // Etapas realizadas: contar si hay fecha de fractura (texto no vacío OR fechaFracturaDate definido)
      if ((etapa.fechaFractura && etapa.fechaFractura !== '') || etapa.fechaFracturaDate) {
        totalStagesPerformed++;
      }
      // Si existe fechaFracturaDate válida, agrupar por día usando esa Date
      if (etapa.fechaFracturaDate instanceof Date && !isNaN(etapa.fechaFracturaDate.getTime())) {
        const dayKey = etapa.fechaFracturaDate.toLocaleDateString();
        stagesPerDay[dayKey] = (stagesPerDay[dayKey] || 0) + 1;
      }
    });
  });
  const avgDepth = depthCount > 0 ? Math.round(totalDepth / depthCount) : 0;
  // Calcular promedio de etapas por día
  const uniqueDates = Object.keys(stagesPerDay);
  let avgStagesPerDay;
  if (uniqueDates.length > 0) {
    const sum = Object.values(stagesPerDay).reduce((a, b) => a + b, 0);
    const avg = sum / uniqueDates.length;
    // calcular promedio sin redondear Math.round(avg)
    // Mantener exactamente 2 decimales como string
    avgStagesPerDay = avg.toFixed(2);
  } else {
    avgStagesPerDay = null; // indicar ausencia para que no se muestre
  }

  // Construir lista de KPIs que pasaremos al footer (oculto por defecto)
  // Omitiremos KPIs cuyo valor sea null, vacío o 'N/A'
  const kpis = [];
  const pushKpi = (title, value) => {
    if (value === null || value === undefined) return;
    const str = (typeof value === 'string') ? value.trim() : String(value);
    if (str === '' || str.toUpperCase() === 'N/A') return;
    kpis.push({ title, value });
  };
  pushKpi('Pozos', wellsCount);
  pushKpi('Etapas totales', totalStagesPerformed);
  // Asegurar que 'Etapas promedio/día' tenga exactamente 2 decimales cuando exista
  if (avgStagesPerDay !== null && avgStagesPerDay !== undefined) {
    // avgStagesPerDay ya es un string con 2 decimales por toFixed, pero normalizamos a número/formato
    const n = Number(avgStagesPerDay);
    if (!isNaN(n)) pushKpi('Etapas promedio/día', n.toFixed(2));
  }
  // Calcular etapas de hoy y de ayer usando el mapa stagesPerDay
  try {
    const now = new Date();
    const todayStr = now.toLocaleDateString();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString();
    const todayCount = stagesPerDay[todayStr] || 0;
    const yesterdayCount = stagesPerDay[yesterdayStr] || 0;
  pushKpi('Etapas (hoy)', todayCount);
  pushKpi('Etapas (ayer)', yesterdayCount);
    // Log para depuración rápida: mostrar el mapa de etapas por día
    try { console.debug('stagesPerDay', stagesPerDay, 'today', todayStr, todayCount, 'yesterday', yesterdayStr, yesterdayCount); } catch (e) {}
  } catch (e) {
    kpis.push({ title: 'Etapas (hoy)', value: 0 });
    kpis.push({ title: 'Etapas (ayer)', value: 0 });
  }
  // No se añade profundidad promedio según los requisitos
  // Construir las tarjetas y añadirlas al footerContent, pero mantener el footer oculto
  kpis.forEach(kpi => {
    const card = document.createElement('div');
    card.className = 'kpi-card';
    const title = document.createElement('div');
    title.className = 'kpi-title';
    title.textContent = kpi.title;
    const value = document.createElement('div');
    value.className = 'kpi-value';
    // Formatear algunas KPIs especiales
    let displayVal = kpi.value;
    // Si el KPI es 'Fecha inicio fractura' intentar formatear usando fechaFracturaDate del primer pozo disponible
    if (kpi.title.toLowerCase().includes('fecha') && typeof kpi.value === 'string') {
      // intentar detectar si el valor es un serial numérico dentro de los datos: en este context usamos el valor tal cual
      displayVal = kpi.value;
    }
    value.textContent = displayVal;
    card.appendChild(title);
    card.appendChild(value);
    footerContent.appendChild(card);
  });
  // Mantener el footer oculto para uso posterior
  if (footer) footer.hidden = true;
}

/**
 * Genera los controles (checkboxes) para que el usuario
 * pueda elegir qué pozos visualizar.
 * @param {object} data Objeto de datos con la lista de pozos.
 */
function renderWellControls(data) {
  const wellControlsContainer = document.getElementById('wellControls');
  // Si no existe el contenedor (porque la UI oculta esta sección), no hacer nada
  if (!wellControlsContainer) return;
  wellControlsContainer.innerHTML = '';
  if (!data || !data.wells) return;
  data.wells.forEach((well, index) => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.dataset.wellIndex = index;
    checkbox.addEventListener('change', (ev) => {
      const idx = ev.target.dataset.wellIndex;
      const tableContainer = document.querySelector(`.table-container[data-well-index="${idx}"]`);
      if (tableContainer) {
        tableContainer.style.display = ev.target.checked ? '' : 'none';
      }
    });
    const span = document.createElement('span');
    span.textContent = well.name;
    label.appendChild(checkbox);
    label.appendChild(span);
    wellControlsContainer.appendChild(label);
  });
}

/**
 * Construye los controles dentro del modal para seleccionar qué pozos
 * visualizar y actualiza la visibilidad de las tablas.
 * @param {object} data Datos estructurados con la propiedad wells.
 */
function renderModalControls(data) {
  const modalContainer = document.getElementById('modalWellControls');
  if (!modalContainer) return;
  modalContainer.innerHTML = '';
  if (!data || !data.wells) return;
  data.wells.forEach((well, index) => {
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '0.25rem';
    label.style.marginRight = '1rem';
    label.style.fontSize = '0.9rem';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    // Guardar nombre del pozo en dataset
    checkbox.dataset.wellName = well.name;
    // Establecer el checked según lista de pozos ocultos
    checkbox.checked = !hiddenWellNames.includes(well.name);
    checkbox.addEventListener('change', (ev) => {
      const wellName = ev.target.dataset.wellName;
      // Actualizar lista de pozos ocultos
      if (ev.target.checked) {
        hiddenWellNames = hiddenWellNames.filter(name => name !== wellName);
      } else {
        if (!hiddenWellNames.includes(wellName)) hiddenWellNames.push(wellName);
      }
      // Guardar cambios
      try {
        localStorage.setItem('hiddenWellNames', JSON.stringify(hiddenWellNames));
      } catch (e) {}
      // Mostrar u ocultar las celdas correspondientes en la tabla unificada
      const cells = document.querySelectorAll(`[data-well-name="${wellName}"]`);
      cells.forEach(cell => {
        cell.style.display = ev.target.checked ? '' : 'none';
      });
      // Recalcular ancho mínimo de la tabla tras cambiar visibilidad
      try { updateTableMinWidth(); } catch (e) {}
    });
    const span = document.createElement('span');
    span.textContent = well.name;
    label.appendChild(checkbox);
    label.appendChild(span);
    modalContainer.appendChild(label);
  });
}

/**
 * Construye los controles dentro del modal para seleccionar qué tarjetas de stock
 * mostrar en el pie de página. Similar a los controles de pozos.
 * @param {object} data Datos con la lista de stock.
 */
function renderStockControls(data) {
  const stockContainer = document.getElementById('modalStockControls');
  if (!stockContainer) return;
  stockContainer.innerHTML = '';
  if (!data || !Array.isArray(data.stock)) return;
  data.stock.forEach(item => {
    const name = item.ITEM;
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '0.25rem';
    label.style.marginRight = '1rem';
    label.style.fontSize = '0.9rem';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.itemName = name;
    checkbox.checked = !hiddenStockItems.includes(name);
    checkbox.addEventListener('change', (ev) => {
      const itemName = ev.target.dataset.itemName;
      if (ev.target.checked) {
        // Mostrar y eliminar de la lista oculta
        hiddenStockItems = hiddenStockItems.filter(n => n !== itemName);
      } else {
        if (!hiddenStockItems.includes(itemName)) hiddenStockItems.push(itemName);
      }
      try {
        localStorage.setItem('hiddenStockItems', JSON.stringify(hiddenStockItems));
      } catch (e) {}
      // Actualizar el pie de página
      updateFooter(currentData);
    });
    const span = document.createElement('span');
    span.textContent = name;
    label.appendChild(checkbox);
    label.appendChild(span);
    stockContainer.appendChild(label);
  });
}

/**
 * Construye y muestra las tablas para cada pozo. Si hay más pozos
 * que el ancho de la pantalla, se mostrará una barra de desplazamiento
 * horizontal en el contenedor.
 * @param {object} data Objeto de datos con pozos y etapas.
 */
function renderTables(data) {
  const wrapper = document.getElementById('tables-wrapper');
  wrapper.innerHTML = '';
  if (!data || !data.wells) return;
  // Unificar todas las tablas en una sola gran tabla con columnas por pozo.
  // Calcular la cantidad máxima de filas entre todos los pozos
  const maxRows = data.wells.reduce((max, well) => Math.max(max, well.etapas.length), 0);
  // Construir contenedor y tabla unificada
  const container = document.createElement('div');
  container.className = 'table-container';
  // Contenedor interior para auto-scroll vertical
  const inner = document.createElement('div');
  inner.className = 'table-wrapper-inner';
  // La indicación de si existen datos significativos se establecerá
  // después de crear las filas, mediante hasAnyValue.
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  // Primera fila de cabecera: encabezado vacío para etapa y encabezados de pozos (colspan)
  const headerRow1 = document.createElement('tr');
  const etapaHeader = document.createElement('th');
  etapaHeader.rowSpan = 2;
  etapaHeader.textContent = 'Etapa';
  headerRow1.appendChild(etapaHeader);
  data.wells.forEach((well, index) => {
    const th = document.createElement('th');
    th.colSpan = 2; // ahora solo 2 columnas por pozo
    th.textContent = well.name;
    th.setAttribute('data-well-name', well.name);
    th.setAttribute('data-well-index', index);
    headerRow1.appendChild(th);
  });
  thead.appendChild(headerRow1);
  // Segunda fila de cabecera: sub columnas para cada pozo
  // Nuevo diseño: 2 columnas por pozo
  //  - Fecha / Hora + Prof (tapon)
  //  - Fecha Fin Frac
  const headerRow2 = document.createElement('tr');
  data.wells.forEach((well, index) => {
    const subs = ['Fecha / Hora + Prof', 'Fecha Fin Frac'];
    subs.forEach(subName => {
      const th = document.createElement('th');
      th.textContent = subName;
      th.setAttribute('data-well-name', well.name);
      // Marcar índice para aplicar colores en subcabecera
      th.setAttribute('data-well-index', index);
      headerRow2.appendChild(th);
    });
  });
  thead.appendChild(headerRow2);
  table.appendChild(thead);
  // Cuerpo de la tabla
  const tbody = document.createElement('tbody');
  for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
    const tr = document.createElement('tr');
    // Celda para el número de etapa (usar primera etapa encontrada)
    let etapaLabel = '';
    // Buscar la etiqueta de etapa en el primer pozo que tenga esa fila
    for (let w = 0; w < data.wells.length; w++) {
      const etapaObj = data.wells[w].etapas[rowIndex];
      if (etapaObj && etapaObj.etapa) {
        etapaLabel = etapaObj.etapa;
        break;
      }
    }
    const etapaTd = document.createElement('td');
    etapaTd.textContent = etapaLabel;
    tr.appendChild(etapaTd);
    // Celdas de cada pozo: ahora 2 columnas por pozo
    // 1) Fecha / Hora (HH:MM) + Profundidad (tapon) - tapon en negrita y mayor tamaño
    // 2) Fecha Fin Frac
    data.wells.forEach((well) => {
      const etapaObj = well.etapas[rowIndex];
      const fechaStr = etapaObj ? etapaObj.fechaHora || '' : '';
      // Separar fecha y hora; queremos mostrar hora en formato corto HH:MM
      let datePart = '';
      let timePart = '';
      if (fechaStr) {
        if (fechaStr.includes(',')) {
          const parts = fechaStr.split(',');
          datePart = parts[0].trim();
          if (parts.length > 1) {
            const rawTime = parts.slice(1).join(',').trim();
            const tMatch = rawTime.match(/(\d{1,2}:\d{2})/);
            timePart = tMatch ? tMatch[1] : rawTime;
          }
        } else {
          const tMatch = fechaStr.match(/(\d{1,2}:\d{2})/);
          timePart = tMatch ? tMatch[1] : fechaStr;
        }
      }
      let profundidad = etapaObj ? ((etapaObj.profundidad === null || etapaObj.profundidad === undefined) ? '' : etapaObj.profundidad) : '';
      const fractura = etapaObj ? etapaObj.fechaFractura || '' : '';
      // Si no hay profundidad, mostrar guion y atenuar
      let taponHtml = '';
      if (profundidad === '' || isNaN(profundidad)) {
        taponHtml = '<span class="tapon-value tapon-empty">—</span>';
      } else {
        taponHtml = `<span class="tapon-value">${profundidad} <span class='tapon-unit'>m</span></span>`;
      }
      const tdCombined = document.createElement('td');
      tdCombined.innerHTML = `<div class="date-part">${datePart}</div><div class="time-part">${timePart}</div><div class="prof-tapon">${taponHtml}</div>`;
      tdCombined.setAttribute('data-well-name', well.name);
      tr.appendChild(tdCombined);
      // Segunda celda: Fecha de finalización/fractura
      const tdFrac = document.createElement('td');
      tdFrac.textContent = fractura;
      tdFrac.setAttribute('data-well-name', well.name);
      tr.appendChild(tdFrac);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  inner.appendChild(table);
  container.appendChild(inner);
  // Establecer un ancho mínimo para la tabla en función del número de columnas.
  // Esto permite que, cuando hay muchos pozos, la tabla se extienda y aparezca
  // una barra de desplazamiento horizontal en pantallas más pequeñas.
  const totalColumns = 1 + data.wells.length * 2; // ahora 2 columnas por pozo
  const baseWidth = 160; // ancho base en píxeles por columna (ligeramente mayor para mejor lectura)
  table.style.minWidth = (totalColumns * baseWidth) + 'px';
  // Calcular si existe al menos un valor (fecha/hora, profundidad numérica
  // o fecha de fractura con formato de fecha) en alguna etapa. Esto se
  // utiliza para evitar desplazar la tabla al final cuando no hay datos
  // significativos.
  let hasAnyValue = false;
  data.wells.forEach(well => {
    for (let idx = 0; idx < well.etapas.length; idx++) {
      const etapaObj = well.etapas[idx];
      if (!etapaObj) continue;
      if (etapaObj.fechaHora && etapaObj.fechaHora.trim() !== '') {
        hasAnyValue = true;
        return;
      }
      if (typeof etapaObj.profundidad === 'number') {
        hasAnyValue = true;
        return;
      }
      if (etapaObj.fechaFractura && etapaObj.fechaFractura.includes('/')) {
        hasAnyValue = true;
        return;
      }
    }
  });
  inner.dataset.hasData = String(hasAnyValue);
  // Vaciar contenedor y añadir la tabla unificada
  wrapper.innerHTML = '';
  // Hacer el contenedor focusable para permitir navegación por teclado en TVs
  wrapper.tabIndex = 0;
  wrapper.appendChild(container);
  // Intentar enfocar el contenedor para recibir eventos de teclado en TVs
  try {
    // Solo forzar el foco si no hay otro elemento enfocado
    if (document.activeElement === document.body || document.activeElement === null) {
      // Pequeño retraso para asegurar que el elemento esté en el DOM
      setTimeout(() => {
        wrapper.focus();
      }, 10);
    }
  } catch (e) {}

  // Añadir manejador de teclado para navegación horizontal en pantallas TV
  // Solo registrar una vez
  if (!wrapper.dataset.tvKeyListener) {
    wrapper.addEventListener('keydown', (ev) => {
      // Evitar interferir con inputs o elementos interactivos
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      const key = normalizeKey(ev);
  // (debug overlay removido)
      const step = 120; // cantidad de px que avanza horizontalmente con cada pulsación (ajustable)
      // Determinar el elemento que contiene overflow horizontal real
      const scroller = findHorizontalScroller() || wrapper;
      // Obtener el contenedor interior para scroll vertical
      const innerEl = (scroller && scroller.querySelector) ? scroller.querySelector('.table-wrapper-inner') : wrapper.querySelector('.table-wrapper-inner');
      switch (key) {
        case 'ArrowRight':
          ev.preventDefault();
          scroller.scrollLeft += step;
          break;
        case 'ArrowLeft':
          ev.preventDefault();
          scroller.scrollLeft -= step;
          break;
        case 'ArrowDown':
          // Scroll vertical dentro de la tabla
          if (innerEl) {
            ev.preventDefault();
            // usar paso relativo a la altura visible
            const vStep = Math.max(40, Math.round(innerEl.clientHeight * 0.12));
            innerEl.scrollTop += vStep;
          }
          break;
        case 'ArrowUp':
          if (innerEl) {
            ev.preventDefault();
            const vStep = Math.max(40, Math.round(innerEl.clientHeight * 0.12));
            innerEl.scrollTop -= vStep;
          }
          break;
        case 'PageDown':
          ev.preventDefault();
          wrapper.scrollLeft += wrapper.clientWidth - 60;
          break;
        case 'PageUp':
          ev.preventDefault();
          wrapper.scrollLeft -= wrapper.clientWidth - 60;
          break;
        case 'Home':
          ev.preventDefault();
          wrapper.scrollLeft = 0;
          break;
        case 'End':
          ev.preventDefault();
          wrapper.scrollLeft = wrapper.scrollWidth;
          break;
        default:
          break;
      }
    });
    // Hacer que el contenedor tenga aria role y etiqueta para accesibilidad TV
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Tabla de pozos, use flechas izquierda/derecha para desplazarse');
    wrapper.dataset.tvKeyListener = '1';
  }

  // Registrar un listener global que reenvíe flechas al contenedor si
  // no hay un control enfocado. Esto ayuda en TVs donde el foco puede
  // quedarse en body y el usuario espera que las flechas muevan la tabla.
  if (!window._pozosTvNavRegistered) {
    window._pozosTvNavRegistered = true;
    document.addEventListener('keydown', (ev) => {
      // No interferir si el usuario está escribiendo
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      const wrapperEl = document.getElementById('tables-wrapper');
      if (!wrapperEl) return;
      // Solo manejar si existe overflow horizontal
      if (wrapperEl.scrollWidth <= wrapperEl.clientWidth) return;
      // Normalizar tecla (soporte keyCode antiguo)
      const key = normalizeKey(ev);
  // (debug overlay removido)
      const step = 120;
      const scroller = findHorizontalScroller() || wrapperEl;
      const inner = (scroller && scroller.querySelector) ? scroller.querySelector('.table-wrapper-inner') : wrapperEl.querySelector('.table-wrapper-inner');
      switch (key) {
        case 'ArrowRight':
          ev.preventDefault();
          scroller.scrollLeft += step;
          break;
        case 'ArrowLeft':
          ev.preventDefault();
          scroller.scrollLeft -= step;
          break;
        case 'ArrowDown':
          if (inner) {
            ev.preventDefault();
            const vStep = Math.max(40, Math.round(inner.clientHeight * 0.12));
            inner.scrollTop += vStep;
          }
          break;
        case 'ArrowUp':
          if (inner) {
            ev.preventDefault();
            const vStep = Math.max(40, Math.round(inner.clientHeight * 0.12));
            inner.scrollTop -= vStep;
          }
          break;
        case 'PageDown':
          ev.preventDefault();
          scroller.scrollLeft += (scroller.clientWidth || wrapperEl.clientWidth) - 60;
          break;
        case 'PageUp':
          ev.preventDefault();
          scroller.scrollLeft -= (scroller.clientWidth || wrapperEl.clientWidth) - 60;
          break;
        case 'Home':
          ev.preventDefault();
          scroller.scrollLeft = 0;
          break;
        case 'End':
          ev.preventDefault();
          scroller.scrollLeft = scroller.scrollWidth || wrapperEl.scrollWidth;
          break;
        default:
          break;
      }
    });
  }
}

/**
 * Actualiza el contenido del pie de página si hay información
 * adicional en los datos. Oculta el pie si no hay nada que mostrar.
 * @param {object} data Objeto de datos con metadatos.
 */
function updateFooter(data) {
  // Ahora esta función coloca las tarjetas de STOCK/Actualización en el contenedor superior de KPIs
  const kpiContainer = document.getElementById('kpi-container');
  if (!kpiContainer) return;
  kpiContainer.innerHTML = '';
  const cards = [];
  // Agregar tarjeta por cada elemento de stock, considerando ocultos
  if (data && Array.isArray(data.stock) && data.stock.length > 0) {
    data.stock.forEach(item => {
      const name = (item.ITEM || '').toString().trim();
      const stockRaw = (item.STOCK === undefined || item.STOCK === null) ? '' : item.STOCK.toString().trim();
      if (!name || name.toUpperCase() === 'N/A') return;
      if (!stockRaw || stockRaw.toUpperCase() === 'N/A') return;
      if (hiddenStockItems.includes(name)) return;
      // Construir tarjeta con formato según tipo
      const card = document.createElement('div');
      card.className = 'kpi-card';
      const title = document.createElement('div');
      title.className = 'kpi-title';
      title.textContent = name;
      const value = document.createElement('div');
      value.className = 'kpi-value';
      // Intentar formatear valores numéricos
     
      const num = parseFloat(stockRaw.replace(/,/g, '.'));
      let display = stockRaw;
      const lname = name.toLowerCase();
      if (!isNaN(num)) {
        // <--- reemplazar TODO lo que hay adentro por esto:
        if (lname.includes('avance') && lname.includes('fractura')) {
          // si viene entre 0 y 1 => convertir a porcentaje
          const pct = (num >= 0 && num <= 1) ? num * 100 : num;
          display = pct.toFixed(1) + '%';
        } else if (lname.includes('fecha') || lname.includes('fractura')) {
          const d = excelSerialToDate(num);
          display = (d && !isNaN(d.getTime())) ? d.toLocaleDateString('es-AR') : stockRaw;
        } else if (lname.includes('/') || lname.includes('etapas/d')) {
          display = num.toFixed(2);
        } else if (lname.includes('etap')) {
          display = String(Math.round(num));
        } else if (lname.includes('dí') || lname.includes('dia') || lname.includes('dias')) {
          display = num.toFixed(2);
        } else {
          display = Number.isInteger(num) ? String(num) : String(num);
        }
      }
      value.textContent = display;
      card.appendChild(title);
      card.appendChild(value);
      cards.push(card);
    });
  }
  // Agregar tarjeta de última actualización si existe
  if (data && data.lastUpdate) {
    const lastUpdateDate = new Date(data.lastUpdate);
    const card = document.createElement('div');
    card.className = 'kpi-card';
    const title = document.createElement('div');
    title.className = 'kpi-title';
    title.textContent = 'Actualización';
    const value = document.createElement('div');
    value.className = 'kpi-value';
    value.textContent = lastUpdateDate.toLocaleString('es-AR', { hour12: false });
    card.appendChild(title);
    card.appendChild(value);
    cards.push(card);
  }
  // Adjuntar tarjetas al contenedor superior
  if (cards.length > 0) {
    cards.forEach(card => kpiContainer.appendChild(card));
  }
}

/**
 * Recalcula el minWidth de la tabla unificada según la cantidad de columnas visibles.
 * Esto permite que cuando el usuario oculta pozos, la tabla se reduzca y no
 * obligue a un scroll horizontal innecesario.
 */
function updateTableMinWidth() {
  const table = document.querySelector('#tables-wrapper table');
  if (!table) return;
  // Contar columnas visibles: la primera columna (Etapa) siempre visible + 3 por cada pozo visible
  const allTh = Array.from(table.querySelectorAll('thead tr:first-child th'));
  // Excluir el primer th (Etapa)
  const wellThs = allTh.slice(1);
  // Cada wellTh representa un pozo (colSpan=3) pero puede estar oculto via display:none
  let visibleWells = 0;
  wellThs.forEach(th => {
    if (th.style.display === 'none' || window.getComputedStyle(th).display === 'none') return;
    visibleWells++;
  });
  // Si no hay wells visibles, mantener al menos 1
  visibleWells = Math.max(1, visibleWells);
  const totalColumns = 1 + visibleWells * 3;
  const baseWidth = 140;
  table.style.minWidth = (totalColumns * baseWidth) + 'px';
}
/**
 * Activa el desplazamiento automático vertical en todas las tablas visibles.
 * Para cada tabla se crea un intervalo que incrementa la posición de scroll
 * y vuelve al inicio al alcanzar el final. Si ya existe un intervalo para
 * una tabla, primero se limpia.
 */
function enableAutoScroll() {
  // Limpiar intervalos y listeners previos para evitar duplicados
  disableAutoScroll();
  const containers = document.querySelectorAll('.table-container');
  containers.forEach(container => {
    const inner = container.querySelector('.table-wrapper-inner');
    if (!inner) return;
    // No aplicar auto-scroll si la tabla no tiene datos (no hay etapas)
    if (inner.dataset.hasData !== 'true') return;
    // Inicializar marca de tiempo del último scroll del usuario
    inner.dataset.lastUserScroll = '0';
    const scrollListener = () => {
      inner.dataset.lastUserScroll = Date.now().toString();
    };
    inner.addEventListener('scroll', scrollListener);
    // Posicionar inicialmente en la última fila con datos (no al final absoluto)
    const initialTarget = getLastDataScroll(inner);
    if (initialTarget > 0) {
      inner.scrollTop = initialTarget;
    }
    // Crear intervalo que desplaza lentamente hacia la última fila con datos
    const intervalId = setInterval(() => {
      // Si el contenedor está oculto, omitir
      if (container.style.display === 'none') return;
      const last = parseInt(inner.dataset.lastUserScroll || '0');
      // Si el usuario ha interactuado en los últimos 3 segundos, no forzar scroll
      if (Date.now() - last < 3000) return;
      const maxScroll = getLastDataScroll(inner);
      if (maxScroll <= 0) return;
      if (inner.scrollTop < maxScroll - 2) {
        inner.scrollTop += 1;
      } else {
        inner.scrollTop = maxScroll;
      }
    }, 50);
    autoScrollData.set(inner, { intervalId, scrollListener });
  });
}

/**
 * Detiene y limpia todos los intervalos de desplazamiento automático
 * de todas las tablas.
 */
function disableAutoScroll() {
  autoScrollData.forEach((data, element) => {
    if (data.intervalId) clearInterval(data.intervalId);
    if (data.scrollListener) element.removeEventListener('scroll', data.scrollListener);
  });
  autoScrollData.clear();
}

/**
 * Convierte una fecha en formato Excel (número serial) a objeto Date.
 * Excel cuenta los días desde 1899-12-31; se resta 25569 para convertir
 * a la época Unix (1970-01-01). Si no es numérico, retorna null.
 * @param {string|number} serial
 * @returns {Date|null}
 */
function excelSerialToDate(serial) {
  const num = parseFloat(serial);
  if (isNaN(num)) return null;
  // Excel serials represent days since 1899-12-31 (with historical quirks).
  // Creating a JS Date directly from a millisecond timestamp and then
  // calling toLocaleDateString can shift the date by the local timezone
  // offset (producing 'yesterday' in some timezones). To avoid this,
  // construimos la fecha tomando los componentes UTC y luego creamos
  // un objeto Date en horario local con esos componentes. De esta forma
  // la fecha resultante refleja correctamente la fecha/hora del serial
  // sin el efecto de desfase por zona horaria.
  const ms = (num - 25569) * 86400 * 1000;
  const utc = new Date(ms);
  // Extraer componentes UTC
  const year = utc.getUTCFullYear();
  const month = utc.getUTCMonth();
  const day = utc.getUTCDate();
  const hours = utc.getUTCHours();
  const minutes = utc.getUTCMinutes();
  const seconds = utc.getUTCSeconds();
  // Crear Date en horario local con los mismos componentes (evita el shift)
  return new Date(year, month, day, hours, minutes, seconds);
}

/**
 * Parsea una cadena de fecha y hora en formato "dd/mm/aaaa" o
 * "dd/mm/aaaa hh:mm" o "dd/mm/aaaa hh:mm:ss" y devuelve un objeto
 * Date local. Si no se puede parsear, retorna null.
 * @param {string} str
 * @returns {Date|null}
 */
function parseDateTimeString(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!trimmed) return null;
  // Separar fecha y hora por espacio
  const parts = trimmed.split(/\s+/);
  const datePart = parts[0];
  const dateSegs = datePart.split('/');
  if (dateSegs.length !== 3) return null;
  const day = parseInt(dateSegs[0], 10);
  const month = parseInt(dateSegs[1], 10);
  const year = parseInt(dateSegs[2], 10);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  let hour = 0, minute = 0, second = 0;
  if (parts.length > 1) {
    const timePart = parts[1];
    const timeSegs = timePart.split(':');
    if (timeSegs.length >= 2) {
      hour = parseInt(timeSegs[0], 10);
      minute = parseInt(timeSegs[1], 10);
      if (timeSegs.length >= 3) {
        second = parseInt(timeSegs[2], 10);
      }
    }
  }
  return new Date(year, month - 1, day, hour, minute, second);
}

/**
 * Transforma la estructura del JSON original en un formato con la propiedad
 * "wells", cada una con su nombre y lista de etapas. Una etapa contiene
 * el número de etapa (fila), la fecha y hora convertidas, la profundidad (numérica
 * si aplica) y la fecha de fractura. Las filas sin número se omiten.
 * @param {object} data Objeto original con la propiedad items.
 * @returns {object} Objeto con un array "wells".
 */
function parseWellsFromData(data) {
  const result = { wells: [] };
  if (!data || !Array.isArray(data.items) || data.items.length === 0) {
    return result;
  }
  // La primera fila contiene los nombres de los pozos (TPNPozoX)
  const headerRow = data.items[0] || {};
  // Crear hasta seis pozos con nombres extraídos de la cabecera
  for (let i = 1; i <= 6; i++) {
    const nameKey = `TPNPozo${i}`;
    const altKey = `FechaFracPozo${i}`;
    // Se utiliza primero el nombre alternativo (FechaFracPozoX) ya que contiene el identificador del pozo (por ejemplo Lca-3001(h)).
    // Utilizar primero el nombre alternativo (FechaFracPozoX) siempre que sea válido y no sea "X"
    let name = headerRow[altKey];
    if (!name || name.toString().trim() === '' || name.toString().trim().toUpperCase() === 'X') {
      name = headerRow[nameKey];
    }
    if (!name || name.toString().trim() === '' || name.toString().trim().toUpperCase() === 'X') {
      name = `Pozo ${i}`;
    }
    result.wells.push({ name: name, etapas: [] });
  }
  // Recorrer filas a partir de la tercera fila (índice 2) para etapas
  for (let j = 2; j < data.items.length; j++) {
    const row = data.items[j];
    if (!row) continue;
    const stageLabel = (row.Fila || '').trim();
    if (!stageLabel) continue;
    for (let i = 1; i <= 6; i++) {
      const well = result.wells[i - 1];
      const secKey = `SecuenciaPozo${i}`;
      const tpnKey = `TPNPozo${i}`;
      const fracKey = `FechaFracPozo${i}`;
      const secVal = row[secKey];
      const tpnVal = row[tpnKey];
      const fracVal = row[fracKey];
      // Convertir fecha y hora. Formatear como DD/MM/AAAA HH:MM:SS en español de Argentina.
      let fechaHoraStr = '';
      if (secVal) {
        const numVal = parseFloat(secVal);
        if (!isNaN(numVal)) {
          // Valor numérico: serial de Excel
          // Convertir correctamente a Date usando excelSerialToDate (evita shifts de timezone)
          const dateObj = excelSerialToDate(numVal);
          if (dateObj) {
            const datePart = dateObj.toLocaleDateString('es-AR');
            const timePart = dateObj.toLocaleTimeString('es-AR', { hour12: false });
            // Guardar fecha y hora en formato legible
            fechaHoraStr = `${datePart}, ${timePart}`;
          } else {
            // Si no se pudo convertir, usar cadena original
            fechaHoraStr = '' + secVal;
          }
        } else if (typeof secVal === 'string' && secVal.trim() !== '') {
          // Intentar parsear cadena dd/mm/aaaa hh:mm
          const dt = parseDateTimeString(secVal);
          if (dt) {
            const datePart = dt.toLocaleDateString('es-AR');
            const timePart = dt.toLocaleTimeString('es-AR', { hour12: false });
            fechaHoraStr = `${datePart}, ${timePart}`;
          } else {
            // Si no se puede parsear, mantener el valor tal cual
            fechaHoraStr = secVal;
          }
        }
      }
      // Convertir profundidad si es numérica
      let profundidadVal = null;
      if (tpnVal && !isNaN(parseFloat(tpnVal))) {
        profundidadVal = parseFloat(tpnVal);
      }
      // Convertir fecha de fractura (puede ser numérica o texto). Si es numérica,
      // formatear como DD/MM/AAAA y además almacenar un objeto Date canónico
      // en `fechaFracDate` para permitir cálculos robustos independientemente
      // del formato de visualización.
      let fechaFracStr = '';
      let fechaFracDate = null;
      if (fracVal) {
        const numFrac = parseFloat(fracVal);
        if (!isNaN(numFrac)) {
          const fracDate = excelSerialToDate(numFrac);
          if (fracDate) {
            fechaFracDate = fracDate;
            fechaFracStr = fracDate.toLocaleDateString('es-AR');
          } else {
            fechaFracStr = '';
          }
        } else {
          // Intentar parsear cadenas tipo dd/mm/aaaa
          const tryDt = parseDateTimeString(fracVal);
          if (tryDt) {
            fechaFracDate = tryDt;
            fechaFracStr = tryDt.toLocaleDateString('es-AR');
          } else {
            // No es una fecha reconocible, mantener el valor tal cual (p.ej. 'FRACTURADO')
            fechaFracStr = fracVal;
            fechaFracDate = null;
          }
        }
      }
      well.etapas.push({
        etapa: stageLabel,
        fechaHora: fechaHoraStr,
        profundidad: profundidadVal,
        fechaFractura: fechaFracStr,
        // fechaFracturaDate es null si no existe o no es parseable
        fechaFracturaDate: fechaFracDate
      });
    }
  }
  // No filtrar pozos sin etapas para poder mostrar columnas vacías y controles para todos los pozos
  return result;
}

/**
 * Desplaza todas las tablas unificadas al final para mostrar las últimas filas.
 * Se utiliza al cargar o actualizar datos cuando el auto-scroll no está activado.
 */
function scrollTablesToBottom() {
  const inners = document.querySelectorAll('.table-container .table-wrapper-inner');
  inners.forEach(inner => {
    // Solo desplazarse si la tabla contiene datos significativos
    if (inner.dataset.hasData === 'true') {
      const targetScroll = getLastDataScroll(inner);
      if (targetScroll > 0) {
        inner.scrollTop = targetScroll;
      }
    }
  });
}

/**
 * Desplaza la tabla a la última fila que contiene datos, mostrando las últimas N filas.
 * Implementación basada en la página que funciona en TV: usa scrollTo con behavior:'smooth'
 * y calcula el target a partir del offsetTop de la fila objetivo teniendo en cuenta
 * la altura de los headers.
 * @param {number} n cantidad de últimas filas con datos a mostrar
 */
function scrollToLastWithData(n) {
  if (typeof n !== 'number') n = 7;
  // Solo actuamos si existe el contenedor principal
  const tableContainer = document.getElementById('tables-wrapper') || document.getElementById('tables-wrapper');
  // Fallback al contenedor existente en este proyecto
  const localContainer = document.getElementById('tables-wrapper') || document.getElementById('tables-wrapper');
  // En nuestro diseño la zona scrollable vertical está dentro de .table-wrapper-inner
  const inner = document.querySelector('.table-container .table-wrapper-inner');
  if (!inner) return;

  // Calcular filas con datos usando latestData (compatible con estructura actual)
  const rows = Array.from(inner.querySelectorAll('tbody tr'));
  // Si no hay filas, nada que hacer
  if (!rows.length) return;

  // Construir índice de filas que tienen datos (mirando celdas con data-well-name no vacías)
  const visibleSet = new Set(); // no necesita pozos filtrados aquí
  const idx = [];
  rows.forEach(function(tr, i){
    // Detectar si la fila tiene alguna celda con texto no vacío
    const cells = tr.querySelectorAll('td');
    let has = false;
    for (let c = 0; c < cells.length; c++){
      const txt = cells[c].textContent || '';
      if (txt.trim() !== '') { has = true; break; }
    }
    if (has) idx.push(i);
  });
  if (!idx.length) return;
  const targetIndex = Math.max(0, idx.length - n);
  const row = rows[idx[targetIndex]];
  if (!row) return;
  // Altura de headers si existen (buscar elementos thead sticky)
  const thead1 = document.querySelector('thead tr:first-child');
  const thead2 = document.querySelector('thead tr:nth-child(2)');
  const headerH = ((thead1?thead1.offsetHeight:0) + (thead2?thead2.offsetHeight:0));
  const targetTop = Math.max(0, row.offsetTop - headerH - 8);
  // Smooth scroll del contenedor principal vertical
  const parent = document.querySelector('.table-container .table-wrapper-inner');
  if (parent) parent.scrollTo({ top: targetTop, behavior: 'smooth' });
}

/**
 * Ajusta la altura máxima de las tablas para que ocupen el espacio
 * disponible en la pantalla, especialmente en monitores de alta
 * resolución. Calcula el espacio disponible restando la altura del
 * encabezado, las tarjetas KPI y el pie (si está visible).
 */
function adjustTableHeight() {
  const header = document.getElementById('header');
  const kpis = document.getElementById('kpi-container');
  const footer = document.getElementById('footer');
  const headerH = header ? header.offsetHeight : 0;
  const kpiH = kpis ? kpis.offsetHeight : 0;
  const footerH = (footer && !footer.hidden) ? footer.offsetHeight : 0;
  // Restar un margen adicional para evitar solapamiento
  const margin = 40;
  const available = Math.max(100, window.innerHeight - headerH - kpiH - footerH - margin);
  document.querySelectorAll('.table-wrapper-inner').forEach(inner => {
    inner.style.maxHeight = available + 'px';
  });
}

/**
 * Aplica el estado de pozos ocultos guardado en localStorage. Esta función
 * se ejecuta después de renderizar las tablas y los controles del modal. Se
 * encarga de ocultar las tablas correspondientes a los pozos que el
 * usuario desactivó previamente y de sincronizar el estado de los
 * checkboxes del modal. Además, depura la lista de nombres ocultos
 * eliminando aquellos que ya no existen en la data actual.
 * @param {object} data Datos estructurados con la propiedad wells.
 */
function applyHiddenWellState(data) {
  if (!data || !Array.isArray(data.wells)) return;
  // Asegurarse de que hiddenWellNames esté inicializado
  if (!Array.isArray(hiddenWellNames)) hiddenWellNames = [];
  // Obtener los nombres válidos de pozos en la data
  const validNames = data.wells.map(well => well.name);
  // Filtrar nombres ocultos que ya no existan en la data
  const updatedHidden = hiddenWellNames.filter(name => validNames.includes(name));
  // Actualizar la variable global y persistir
  hiddenWellNames = updatedHidden;
  try {
    localStorage.setItem('hiddenWellNames', JSON.stringify(hiddenWellNames));
  } catch (e) {}
  // Ocultar o mostrar celdas correspondientes a cada pozo en la tabla unificada
  const allCells = document.querySelectorAll('[data-well-name]');
  allCells.forEach(cell => {
    const name = cell.getAttribute('data-well-name');
    if (hiddenWellNames.includes(name)) {
      cell.style.display = 'none';
    } else {
      cell.style.display = '';
    }
  });
  // Sincronizar estado de checkboxes del modal
  document.querySelectorAll('#modalWellControls input[type="checkbox"]').forEach(cb => {
    const name = cb.dataset.wellName;
    cb.checked = !hiddenWellNames.includes(name);
  });
  // Ajustar el ancho mínimo de la tabla según pozos visibles
  try { updateTableMinWidth(); } catch (e) {}
}

/**
 * Devuelve un color de texto adecuado (claro u oscuro) basado en la
 * luminosidad del color de fondo. Usa la fórmula de luminosidad
 * perceptual. Si el fondo es claro, devuelve un color oscuro, y viceversa.
 * @param {string} hexColor Color en formato hexadecimal (p.ej. '#ff9900')
 */
function getContrastColor(hexColor) {
  if (!hexColor || typeof hexColor !== 'string') return '#002';
  const hex = hexColor.replace('#', '');
  if (hex.length !== 6) return '#002';
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  // Luminosidad perceptual
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 150 ? '#002' : '#fff';
}

/**
 * Aplica los colores configurados a los encabezados de las tablas de pozos.
 * Utiliza el array wellColors para asignar colores de fondo y texto.
 */
function applyWellColors() {
  const topHeaders = document.querySelectorAll('#tables-wrapper thead tr:first-child th[data-well-index]');
  const subHeaders = document.querySelectorAll('#tables-wrapper thead tr:nth-child(2) th[data-well-index]');
  topHeaders.forEach(th => {
    const idx = parseInt(th.getAttribute('data-well-index'), 10);
    if (isNaN(idx)) return;
    const color = wellColors[idx] || defaultWellColors[idx] || '#ccc';
    th.style.backgroundColor = color;
    th.style.color = getContrastColor(color);
  });
  subHeaders.forEach(th => {
    const idx = parseInt(th.getAttribute('data-well-index'), 10);
    if (isNaN(idx)) return;
    const color = wellColors[idx] || defaultWellColors[idx] || '#ccc';
    // Usar el mismo color o un tono más claro para las subcabeceras
    th.style.backgroundColor = color;
    th.style.color = getContrastColor(color);
  });
}

/**
 * Genera controles de selección de colores en el modal de ajustes para
 * permitir al usuario personalizar los colores de los encabezados de los
 * pozos. Al cambiar un color, se actualiza wellColors y se guardan
 * en localStorage.
 * @param {object} data Datos estructurados con wells.
 */
function renderColorControls(data) {
  const container = document.getElementById('modalColorControls');
  if (!container) return;
  container.innerHTML = '';
  if (!data || !Array.isArray(data.wells)) return;
  data.wells.forEach((well, idx) => {
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '0.5rem';
    wrapper.style.marginBottom = '0.25rem';
    const label = document.createElement('span');
    label.textContent = well.name;
    label.style.flex = '1';
    const input = document.createElement('input');
    input.type = 'color';
    input.value = wellColors[idx] || defaultWellColors[idx];
    input.addEventListener('input', () => {
      wellColors[idx] = input.value;
      try { localStorage.setItem('wellColors', JSON.stringify(wellColors)); } catch (e) {}
      applyWellColors();
    });
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    container.appendChild(wrapper);
  });
}
