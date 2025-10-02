/*
 * Archivo principal de JavaScript para el dashboard de pozos.
 * Se encarga de leer el JSON con los datos de los pozos, construir
 * dinámicamente las tarjetas KPI, tablas y controles de selección,
 * así como gestionar los eventos de tema oscuro, auto desplazamiento
 * y cambios en los datos.
 */

// Mantendrá la data actual para detectar cambios.
let currentData = null;
// Mapeará los intervalos de auto-scroll por tabla
const autoScrollIntervals = new Map();

/**
 * Al cargar el contenido del documento, configuramos los eventos
 * iniciales y solicitamos los datos.
 */
document.addEventListener('DOMContentLoaded', () => {
  // Configurar el toggle de tema oscuro/claro
  const themeToggle = document.getElementById('themeToggle');
  // Aplicar el tema guardado en localStorage
  const savedTheme = localStorage.getItem('theme') || 'light';
  if (savedTheme === 'dark') {
    document.body.classList.add('dark');
    themeToggle.checked = true;
  }
  themeToggle.addEventListener('change', () => {
    if (themeToggle.checked) {
      document.body.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.body.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  });

  // Configurar el botón del menú lateral
  const menuToggle = document.getElementById('menuToggle');
  menuToggle.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('main').classList.toggle('shifted');
  });

  // Configurar el toggle de auto-scroll
  const autoScrollToggle = document.getElementById('autoScrollToggle');
  autoScrollToggle.addEventListener('change', () => {
    if (autoScrollToggle.checked) {
      enableAutoScroll();
    } else {
      disableAutoScroll();
    }
  });

  // Cargar datos iniciales
  fetchData();
  // Revisar datos cada minuto para detectar cambios en el JSON
  setInterval(() => fetchData(true), 60000);
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
  // Si el auto-scroll estaba activado, reiniciar intervalos para que
  // se apliquen a las nuevas tablas.
  const autoScrollToggle = document.getElementById('autoScrollToggle');
  if (autoScrollToggle.checked) {
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
  const kpiContainer = document.getElementById('kpi-container');
  kpiContainer.innerHTML = '';
  if (!data || !data.wells) return;
  // Calcular métricas básicas
  const wellsCount = data.wells.length;
  const totalStages = data.wells.reduce((acc, well) => acc + well.etapas.length, 0);
  // Calcular profundidad promedio considerando solo valores numéricos
  let totalDepth = 0;
  let depthCount = 0;
  data.wells.forEach(well => {
    well.etapas.forEach(etapa => {
      if (typeof etapa.profundidad === 'number') {
        totalDepth += etapa.profundidad;
        depthCount++;
      }
    });
  });
  const avgDepth = depthCount > 0 ? Math.round(totalDepth / depthCount) : 0;
  const lastUpdate = data.lastUpdate ? new Date(data.lastUpdate) : null;

  // Definir KPIs a mostrar; cada entrada tiene título y valor
  const kpis = [
    { title: 'Pozos', value: wellsCount },
    { title: 'Etapas totales', value: totalStages },
    { title: 'Prof. promedio', value: depthCount > 0 ? avgDepth + ' m' : 'N/A' },
    { title: 'Actualización', value: lastUpdate ? lastUpdate.toLocaleDateString() : 'N/A' }
  ];
  // Construir las tarjetas
  kpis.forEach(kpi => {
    const card = document.createElement('div');
    card.className = 'kpi-card';
    const title = document.createElement('div');
    title.className = 'kpi-title';
    title.textContent = kpi.title;
    const value = document.createElement('div');
    value.className = 'kpi-value';
    value.textContent = kpi.value;
    card.appendChild(title);
    card.appendChild(value);
    kpiContainer.appendChild(card);
  });
}

/**
 * Genera los controles (checkboxes) para que el usuario
 * pueda elegir qué pozos visualizar.
 * @param {object} data Objeto de datos con la lista de pozos.
 */
function renderWellControls(data) {
  const wellControlsContainer = document.getElementById('wellControls');
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
 * Construye y muestra las tablas para cada pozo. Si hay más pozos
 * que el ancho de la pantalla, se mostrará una barra de desplazamiento
 * horizontal en el contenedor.
 * @param {object} data Objeto de datos con pozos y etapas.
 */
function renderTables(data) {
  const wrapper = document.getElementById('tables-wrapper');
  wrapper.innerHTML = '';
  if (!data || !data.wells) return;
  data.wells.forEach((well, index) => {
    const container = document.createElement('div');
    container.className = 'table-container';
    container.dataset.wellIndex = index;
    // Título de la tabla con el nombre del pozo
    const title = document.createElement('h3');
    title.textContent = well.name;
    container.appendChild(title);
    // Contenedor interior para habilitar el desplazamiento vertical
    const inner = document.createElement('div');
    inner.className = 'table-wrapper-inner';
    // Crear la tabla
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Etapa', 'Fecha y hora', 'Profundidad (m)', 'Fecha fractura'].forEach(colName => {
      const th = document.createElement('th');
      th.textContent = colName;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    // Cuerpo de la tabla con las etapas
    const tbody = document.createElement('tbody');
    well.etapas.forEach(etapa => {
      const tr = document.createElement('tr');
      const etapaTd = document.createElement('td');
      etapaTd.textContent = etapa.etapa;
      const fechaHoraTd = document.createElement('td');
      fechaHoraTd.textContent = etapa.fechaHora;
      const profundidadTd = document.createElement('td');
      profundidadTd.textContent = etapa.profundidad === null || etapa.profundidad === undefined ? '' : etapa.profundidad;
      const fracturaTd = document.createElement('td');
      fracturaTd.textContent = etapa.fechaFractura;
      tr.appendChild(etapaTd);
      tr.appendChild(fechaHoraTd);
      tr.appendChild(profundidadTd);
      tr.appendChild(fracturaTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    inner.appendChild(table);
    container.appendChild(inner);
    wrapper.appendChild(container);
  });
}

/**
 * Actualiza el contenido del pie de página si hay información
 * adicional en los datos. Oculta el pie si no hay nada que mostrar.
 * @param {object} data Objeto de datos con metadatos.
 */
function updateFooter(data) {
  const footer = document.getElementById('footer');
  const footerContent = document.getElementById('footerContent');
  let content = '';
  // Mostrar la tabla de stock si existe
  if (data && Array.isArray(data.stock) && data.stock.length > 0) {
    content += '<table><thead><tr><th>Item</th><th>Stock</th></tr></thead><tbody>';
    data.stock.forEach(item => {
      content += `<tr><td>${item.ITEM}</td><td>${item.STOCK}</td></tr>`;
    });
    content += '</tbody></table>';
  }
  // Mostrar la fecha de última actualización si existe
  if (data && data.lastUpdate) {
    const lastUpdateDate = new Date(data.lastUpdate);
    content += `<div class="last-update">Última actualización: ${lastUpdateDate.toLocaleString()}</div>`;
  }
  if (content) {
    footerContent.innerHTML = content;
    footer.hidden = false;
  } else {
    footerContent.innerHTML = '';
    footer.hidden = true;
  }
}

/**
 * Activa el desplazamiento automático vertical en todas las tablas visibles.
 * Para cada tabla se crea un intervalo que incrementa la posición de scroll
 * y vuelve al inicio al alcanzar el final. Si ya existe un intervalo para
 * una tabla, primero se limpia.
 */
function enableAutoScroll() {
  // Limpiar intervalos previos para evitar duplicados
  disableAutoScroll();
  const containers = document.querySelectorAll('.table-container');
  containers.forEach(container => {
    const inner = container.querySelector('.table-wrapper-inner');
    if (!inner) return;
    // Configurar scroll automático solo si hay más filas de las que caben
    const intervalId = setInterval(() => {
      // Si el elemento está oculto, no se le aplica el desplazamiento
      if (container.style.display === 'none') return;
      // Si se llegó al final, reiniciar al principio
      if (inner.scrollTop + inner.clientHeight >= inner.scrollHeight) {
        inner.scrollTop = 0;
      } else {
        // Incrementar scroll suavemente
        inner.scrollTop += 1;
      }
    }, 50); // velocidad de desplazamiento; ajustar según necesidad
    autoScrollIntervals.set(inner, intervalId);
  });
}

/**
 * Detiene y limpia todos los intervalos de desplazamiento automático
 * de todas las tablas.
 */
function disableAutoScroll() {
  autoScrollIntervals.forEach((intervalId, element) => {
    clearInterval(intervalId);
  });
  autoScrollIntervals.clear();
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
  const unixTimestamp = (num - 25569) * 86400 * 1000;
  return new Date(unixTimestamp);
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
    const name = headerRow[nameKey] || headerRow[altKey] || `Pozo ${i}`;
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
      // Convertir fecha y hora
      let fechaHoraStr = '';
      if (secVal && !isNaN(parseFloat(secVal))) {
        const dateObj = excelSerialToDate(secVal);
        fechaHoraStr = dateObj ? dateObj.toLocaleString() : '';
      }
      // Convertir profundidad si es numérica
      let profundidadVal = null;
      if (tpnVal && !isNaN(parseFloat(tpnVal))) {
        profundidadVal = parseFloat(tpnVal);
      }
      // Convertir fecha de fractura (puede ser numérica o texto)
      let fechaFracStr = '';
      if (fracVal) {
        if (!isNaN(parseFloat(fracVal))) {
          const fracDate = excelSerialToDate(fracVal);
          fechaFracStr = fracDate ? fracDate.toLocaleDateString() : '';
        } else {
          fechaFracStr = fracVal;
        }
      }
      well.etapas.push({
        etapa: stageLabel,
        fechaHora: fechaHoraStr,
        profundidad: profundidadVal,
        fechaFractura: fechaFracStr
      });
    }
  }
  // Filtrar pozos sin etapas
  result.wells = result.wells.filter(well => well.etapas.length > 0);
  return result;
}
