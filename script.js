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
  const dataUrl = isFileProtocol ? 'data.json' : 'data.json?ts=' + Date.now();
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
    });
}

/**
 * Renderiza todas las partes del dashboard de acuerdo a los datos
 * proporcionados.
 * @param {object} data Objeto con información de pozos y metadatos.
 */
function updateDashboard(data) {
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
  const totalDepth = data.wells.reduce((acc, well) => acc + well.etapas.reduce((s, e) => s + e.profundidad, 0), 0);
  const avgDepth = totalStages > 0 ? Math.round(totalDepth / totalStages) : 0;
  const lastUpdate = data.lastUpdate ? new Date(data.lastUpdate) : null;

  // Definir KPIs a mostrar; cada entrada tiene título y valor
  const kpis = [
    { title: 'Pozos', value: wellsCount },
    { title: 'Etapas totales', value: totalStages },
    { title: 'Profundidad promedio', value: avgDepth + ' m' },
    { title: 'Última actualización', value: lastUpdate ? lastUpdate.toLocaleDateString() : 'N/A' }
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
      profundidadTd.textContent = etapa.profundidad;
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
  if (data && data.lastUpdate) {
    const lastUpdateDate = new Date(data.lastUpdate);
    footerContent.textContent = 'Datos actualizados al ' + lastUpdateDate.toLocaleString();
    footer.hidden = false;
  } else {
    footerContent.textContent = '';
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
