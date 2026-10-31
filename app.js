/* Dulzú · Cotizador (30/10/2026)
   - El catálogo (sabores, recetas, ingredientes, parámetros, bocaditos…) se baja de Google una vez y queda en el teléfono.
   - Todo el cálculo es local (calc.js): elegir, cambiar cantidades y ver el total no llama al servidor.
   - Al servidor solo se va para: refrescar el catálogo, guardar la cotización, ver el historial y preparar la hoja del cliente. */
(function () {
  'use strict';

  var API = 'https://script.google.com/macros/s/AKfycbwIDp3-xUtD7GFfvjS-g6oCFJ8HVKtSfjLjXT5j_96P2qnaOL4rvSRajMWdTSrYWAlg/exec';
  var HUB = API;
  var LS = { key: 'dzk', cat: 'dz_cat2', borrador: 'dz_borrador', cola: 'dz_cola', hist: 'dz_hist' };
  var SUGERIDOS = ['Caja de torta', 'Base', 'Sticker Dulzú', 'Topper', 'Papel de arroz', 'Perlas / decoracion'];

  // ---------- utilidades ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return 'S/ ' + (Number(n) || 0).toFixed(2); }
  function fmt0(n) { var v = Number(n) || 0; return 'S/ ' + (Math.abs(v - Math.round(v)) < 0.005 ? Math.round(v) : v.toFixed(2)); }
  function leer(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function guardarLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function copia(x) { return JSON.parse(JSON.stringify(x)); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function plural(n, a, b) { return n === 1 ? a : b; }

  // ---------- clave ----------
  var KEY = '';
  (function () {
    var m = location.hash.match(/k=([^&]+)/);
    if (m) { KEY = decodeURIComponent(m[1]); try { localStorage.setItem(LS.key, KEY); } catch (e) { } }
    if (!KEY) { try { KEY = localStorage.getItem(LS.key) || ''; } catch (e) { } }
  })();

  // ---------- API ----------
  function qs(o) { return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&'); }
  function apiGet(o) {
    o.k = KEY;
    return fetch(API + '?' + qs(o)).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) throw new Error(j.error || 'Error del servidor'); return j;
    });
  }
  function apiPost(api, data) {
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ k: KEY, api: api, data: data }) })
      .then(function (r) { return r.json(); }).then(function (j) { if (!j.ok) throw new Error(j.error || 'Error del servidor'); return j; });
  }
  function msgError(err) {
    var m = (err && err.message) || String(err);
    if (/fetch|network|Failed|Load failed/i.test(m)) return 'Sin conexión con Google';
    return m;
  }

  // ---------- catálogo ----------
  var CAT = leer(LS.cat, null);
  var GRUPOS = { boc: [], tem: [], pos: [] };
  var PROD = {}; // nombre -> {b, grupo}
  function prepararCatalogo() {
    GRUPOS = { boc: [], tem: [], pos: [] }; PROD = {};
    (CAT.bocaditos || []).forEach(function (b) {
      var g = b.categoria === 'Temático' ? 'tem' : (b.categoria === 'Postre' ? 'pos' : 'boc');
      GRUPOS[g].push(b); PROD[b.nombre] = { b: b, grupo: g };
    });
  }
  function firmaCatalogo(c) { var x = copia(c); delete x.leido; delete x.appVer; return JSON.stringify(x); }
  function bajarCatalogo() {
    return apiGet({ api: 'catalogo' }).then(function (j) {
      var nuevo = j.data;
      var cambio = !CAT || firmaCatalogo(CAT) !== firmaCatalogo(nuevo);
      CAT = nuevo; guardarLS(LS.cat, CAT); prepararCatalogo();
      return cambio;
    });
  }

  // ---------- estado ----------
  var S = null;           // cotización en curso
  var ui = { ruta: 'inicio', tab: 'cotizar', vista: 'armar', abiertos: {}, cat: 'todos', q: '', hq: '', hmes: '', hpruebas: false, hn: 30, habierto: null };
  var calc = null;        // último resultado de DZCalc.cotizar
  var HIST = leer(LS.hist, []);

  function nuevaCotizacion() {
    var formas = CAT.init.formas;
    var forma = formas[0];
    var extras = [];
    SUGERIDOS.forEach(function (n) {
      var e = empaque(n);
      if (e && n !== 'Caja de torta' && n !== 'Base') extras.push({ concepto: n, costo: e.precio });
    });
    return {
      id: uid(), estado: 'nueva', cliente: '', conTorta: true, cantidad: 1,
      sabor: CAT.init.sabores[0] || '', forma: forma, tamano: (CAT.init.tamanosPorForma[forma] || [])[0] || '',
      nivel: (CAT.niveles[0] || {}).nombre || '',
      minBase: 120, minExtra: 0, minHorno: 50, minBat: 15,
      pisos: [], rellenos: [], extras: extras, items: {}, cargada: null
    };
  }
  function empaque(nombre) { return (CAT.empaques || []).filter(function (e) { return e.nombre === nombre; })[0] || null; }

  function payload() {
    var p = {
      cliente: S.cliente, sabor: S.sabor, forma: S.forma, tamano: S.tamano, nivel: S.nivel,
      minBase: Number(S.minBase) || 0, minExtra: Number(S.minExtra) || 0, minHorno: Number(S.minHorno) || 0, minBat: Number(S.minBat) || 0,
      cantidad: S.cantidad,
      pisos: S.pisos.map(function (x) { return { sabor: x.sabor, forma: x.forma, tamano: x.tamano }; }),
      bocaditos: [], tematicos: [], postres: [],
      soloBocaditos: !S.conTorta,
      rellenos: S.rellenos.map(function (r) { return { ingrediente: r.ingrediente, cantidad: String(r.cantidad == null ? '' : r.cantidad) }; }),
      gastosExtra: S.extras.map(function (g) { return { concepto: g.concepto, costo: String(g.costo == null ? '' : g.costo) }; })
    };
    Object.keys(S.items).forEach(function (n) {
      var q = S.items[n]; var pr = PROD[n];
      if (!pr || !(q > 0)) return;
      var lista = pr.grupo === 'boc' ? p.bocaditos : (pr.grupo === 'tem' ? p.tematicos : p.postres);
      lista.push({ nombre: n, paquetes: q });
    });
    return p;
  }

  function recalcular() {
    calc = DZCalc.cotizar(CAT, payload());
    guardarLS(LS.borrador, S);
  }
  function cambio(estructura) {
    if (S.estado !== 'nueva') { S.estado = 'nueva'; S.id = uid(); S.hojaUrl = ''; }
    recalcular();
    if (estructura) render(); else refrescarNumeros();
  }

  function nProductos() {
    var n = S.conTorta ? 1 : 0;
    Object.keys(S.items).forEach(function (k) { if (S.items[k] > 0 && PROD[k]) n++; });
    return n;
  }

  // ---------- render general ----------
  function render() {
    var enInicio = ui.ruta === 'inicio';
    $('top').hidden = enInicio;
    if (enInicio) { $('barra').hidden = true; $('main').innerHTML = htmlInicio(); return; }
    $('tabCotizar').setAttribute('aria-selected', ui.tab === 'cotizar');
    $('tabHist').setAttribute('aria-selected', ui.tab === 'historial');
    if (ui.tab === 'historial') { renderHistorial(); $('barra').hidden = true; return; }
    $('barra').hidden = false;
    var pos = guardarScrollFichas();
    $('main').innerHTML = ui.vista === 'resumen' ? htmlResumen() : htmlArmar();
    restaurarScrollFichas(pos);
    refrescarNumeros();
  }
  // Las filas de fichas (tamaño, nivel, categorías) recuerdan hasta dónde se deslizaron
  function guardarScrollFichas() {
    var pos = {};
    Array.prototype.forEach.call(document.querySelectorAll('.chips[data-k]'), function (el) { pos[el.getAttribute('data-k')] = el.scrollLeft; });
    return pos;
  }
  function restaurarScrollFichas(pos) {
    Array.prototype.forEach.call(document.querySelectorAll('.chips[data-k]'), function (el) {
      var k = el.getAttribute('data-k');
      if (pos[k]) el.scrollLeft = pos[k];
      else { var on = el.querySelector('[aria-pressed=true]'); if (on && on.offsetLeft + on.offsetWidth > el.clientWidth) el.scrollLeft = on.offsetLeft - 16; }
    });
  }

  function refrescarNumeros() {
    var r = calc.r;
    var total = calc.vacio ? 0 : r.totalPedido;
    $('barraTotal').textContent = fmt0(total);
    var np = nProductos();
    $('barraSub').textContent = 'Total · ' + np + ' ' + plural(np, 'producto', 'productos');
    var b = $('barraBtn');
    if (ui.tab !== 'cotizar') return;
    if (ui.vista === 'armar') {
      b.textContent = 'Ver resumen'; b.className = 'btn'; b.disabled = np === 0;
    } else if (S.estado === 'nueva') {
      b.textContent = 'Guardar'; b.className = 'btn'; b.disabled = !!calc.vacio;
    } else {
      b.textContent = 'Nueva cotización'; b.className = 'btn sec2'; b.disabled = false;
    }
    var tp = $('tortaPrecio');
    if (tp) tp.innerHTML = S.conTorta && !calc.vacio ? (fmt0(r.precioRedondeado) + (S.cantidad > 1 ? '<small>' + fmt(r.precioUnitario) + ' c/u</small>' : '')) : '';
    var te = $('tortaError');
    if (te) { var err = S.conTorta && r && r.error; te.hidden = !err; te.textContent = err ? 'Sin costo de receta: ' + r.error : ''; }
    var pc = $('prodCuenta');
    if (pc) { var n = np - (S.conTorta ? 1 : 0); pc.textContent = n ? n + ' ' + plural(n, 'agregado', 'agregados') : ''; }
    Array.prototype.forEach.call(document.querySelectorAll('[data-sub]'), function (el) {
      var k = el.getAttribute('data-sub');
      if (k === 'trabajo') el.innerHTML = '<b>' + minutosTotales() + ' min</b> · horno ' + (Number(S.minHorno) || 0);
      if (k === 'relleno') { var n2 = S.rellenos.filter(function (x) { return x.ingrediente && Number(x.cantidad) > 0; }).length; el.innerHTML = n2 ? '<b>' + n2 + '</b> ' + plural(n2, 'ingrediente', 'ingredientes') : 'Ninguno'; }
      if (k === 'extras') { var ex = S.extras.filter(function (x) { return x.concepto && Number(x.costo) > 0; }); el.textContent = ex.length ? ex.map(function (x) { return corto(x.concepto); }).join(', ') : 'Ninguno'; }
      if (k === 'pisos') el.textContent = S.pisos.length ? S.pisos.length + ' ' + plural(S.pisos.length, 'piso', 'pisos') + ' encima' : 'Ninguno';
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-rsub]'), function (el) {
      var i = Number(el.getAttribute('data-rsub')); var r2 = S.rellenos[i]; if (!r2) return;
      var cu = CAT.ingredientes[String(r2.ingrediente).trim()] || 0;
      el.textContent = r2.ingrediente ? fmt(cu * (Number(r2.cantidad) || 0)) : '';
    });
    var mt = $('minTotal');
    if (mt) mt.textContent = minutosTotales() + ' min de trabajo en total (incluye ' + (nivelSel().min || 0) + ' min del nivel de diseño)';
  }
  function corto(s) { return String(s).replace(/ Dulzú$/, '').replace(/^Caja de torta/, 'Caja').replace(/ \/ decoracion$/i, ''); }
  function nivelSel() { return CAT.niveles.filter(function (n) { return n.nombre === S.nivel; })[0] || { min: 0, prima: 0 }; }
  function minutosTotales() { return (Number(S.minBase) || 0) + (nivelSel().min || 0) + (Number(S.minExtra) || 0); }

  // ---------- vista: armar ----------
  var ICON_CHEV = '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
  var ICON_LUPA = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A8968A" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

  function stepper(accion, valor, min, opts) {
    opts = opts || {};
    return '<div class="step' + (opts.ancho ? ' ancho' : '') + '">' +
      '<button type="button" data-a="' + accion + '" data-d="-1" aria-label="Menos"' + (valor <= min ? ' disabled' : '') + '>−</button>' +
      '<input type="number" inputmode="numeric" data-in="' + accion + '" value="' + valor + '" min="' + min + '" aria-label="' + esc(opts.label || 'Cantidad') + '">' +
      '<button type="button" data-a="' + accion + '" data-d="1" aria-label="Más">+</button></div>';
  }

  function htmlArmar() {
    var h = '';
    if (S.cargada) {
      h += '<div class="aviso verde" style="margin:6px 0 4px"><b>Cotización cargada' + (S.cargada.cliente ? ': ' + esc(S.cargada.cliente) : '') + '</b> (' + esc(S.cargada.fecha) + ', total ' + fmt(S.cargada.total) + '). ' +
        'Se recalcula con los precios de hoy y se guarda como una cotización nueva.' +
        (S.cargada.avisos && S.cargada.avisos.length ? '<ul style="margin:6px 0 0;padding-left:18px">' + S.cargada.avisos.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>' : '') +
        '<div><button type="button" class="volver" data-a="cerrarCargada" style="color:var(--verde)">Entendido</button></div></div>';
    }
    h += '<label class="lbl" for="cliente" style="margin-top:6px">Cliente o pedido</label>' +
      '<input class="input" id="cliente" data-in="cliente" autocomplete="off" placeholder="Ej. María · cumpleaños 20 personas" value="' + esc(S.cliente) + '">';
    h += htmlTorta();
    h += htmlProductos();
    return h;
  }

  function htmlTorta() {
    var I = CAT.init;
    var h = '<section class="sec" aria-label="Torta"><div class="sec-h"><i class="petal c-torta"></i><h2>Torta</h2><span class="precio" id="tortaPrecio"></span>' +
      '<button type="button" class="sw" role="switch" aria-checked="' + S.conTorta + '" aria-label="Incluir torta" data-a="conTorta"></button></div>';
    if (!S.conTorta) return h + '<p class="nota" style="padding:0 14px 14px;margin:0">Pedido sin torta: solo bocaditos o postres.</p></section>';
    h += '<div class="aviso" id="tortaError" hidden></div>';
    h += '<div class="fila"><span class="k">Cantidad<small>Tortas iguales</small></span>' + stepper('cantidad', S.cantidad, 1, { label: 'Cantidad de tortas' }) + '</div>';
    h += '<div class="fila"><span class="k">Sabor</span><button type="button" class="selector" data-a="elegirSabor" data-i="-1">' + esc(S.sabor || 'Elegir') + ICON_CHEV + '</button></div>';
    h += '<div class="bloque"><span class="lbl">Forma</span>' + htmlFormas(S.forma, -1) + '</div>';
    h += '<div class="bloque"><span class="lbl">Tamaño</span>' + htmlTamanos(S.forma, S.tamano, -1) + '</div>';
    var nv = nivelSel();
    h += '<div class="bloque"><span class="lbl">Nivel de diseño</span><div class="chips" data-k="nivel">' + CAT.niveles.map(function (n) {
      return '<button type="button" class="chip" data-a="nivel" data-v="' + esc(n.nombre) + '" aria-pressed="' + (n.nombre === S.nivel) + '">' + esc(n.nombre) + '</button>';
    }).join('') + '</div><p class="nota">' + (S.nivel ? esc(S.nivel) + ': ' + (nv.min || 0) + ' min de decoración · prima ' + Math.round((nv.prima || 0) * 100) + ' %' : '') + '</p></div>';
    h += acc('pisos', 'Pisos adicionales', htmlPisos());
    h += acc('trabajo', 'Tiempo de trabajo', htmlTrabajo());
    h += acc('relleno', 'Relleno y cobertura', htmlRelleno());
    h += acc('extras', 'Empaque y extras', htmlExtras());
    return h + '</section>';
  }
  function acc(k, titulo, cuerpo) {
    var ab = !!ui.abiertos[k];
    return '<button type="button" class="acc" data-a="acc" data-v="' + k + '" aria-expanded="' + ab + '"><span class="k" style="font-weight:500;font-size:15px">' + titulo + '</span><span class="v"><span data-sub="' + k + '"></span>' + ICON_CHEV + '</span></button>' +
      (ab ? '<div class="panel">' + cuerpo + '</div>' : '');
  }
  function htmlFormas(sel, i) {
    return '<div class="seg">' + CAT.init.formas.map(function (f) {
      return '<button type="button" data-a="forma" data-i="' + i + '" data-v="' + esc(f) + '" aria-pressed="' + (f === sel) + '">' + esc(f) + '</button>';
    }).join('') + '</div>';
  }
  function htmlTamanos(forma, sel, i) {
    var l = CAT.init.tamanosPorForma[forma] || [];
    return '<div class="chips" data-k="tam' + i + '">' + (l.length ? l.map(function (t) {
      return '<button type="button" class="chip" data-a="tamano" data-i="' + i + '" data-v="' + esc(t) + '" aria-pressed="' + (t === sel) + '">' + esc(t) + '</button>';
    }).join('') : '<span class="nota">No hay tamaños para esta forma.</span>') + '</div>';
  }
  function htmlPisos() {
    var h = '<p class="nota" style="margin-top:4px">El keke de arriba es el piso 1 (la base). Agrega los pisos que van encima.</p>';
    S.pisos.forEach(function (p, i) {
      var rr = DZCalc.costoReceta(CAT, p.sabor, p.forma, p.tamano);
      h += '<div class="piso"><div class="piso-h"><b>Piso ' + (i + 2) + '</b><span class="nota" style="margin:0;flex:1;text-align:right">' + (rr.ok ? 'receta ' + fmt(rr.costo) : 'sin receta') + '</span>' +
        '<button type="button" class="quitar" data-a="quitarPiso" data-i="' + i + '" aria-label="Quitar piso ' + (i + 2) + '">✕</button></div>' +
        '<div class="fila" style="padding:0;border:0;min-height:48px"><span class="k">Sabor</span><button type="button" class="selector" data-a="elegirSabor" data-i="' + i + '">' + esc(p.sabor) + ICON_CHEV + '</button></div>' +
        htmlFormas(p.forma, i) + htmlTamanos(p.forma, p.tamano, i) + '</div>';
    });
    var avisos = [];
    var lista = [{ tamano: S.tamano }].concat(S.pisos);
    for (var k = 1; k < lista.length; k++) {
      var a = parseFloat(lista[k - 1].tamano), b = parseFloat(lista[k].tamano);
      if (!isNaN(a) && !isNaN(b) && b >= a) avisos.push('el piso ' + (k + 1) + ' (' + lista[k].tamano + ') no es más chico que el piso ' + k + ' (' + lista[k - 1].tamano + ')');
    }
    if (avisos.length) h += '<p class="nota" style="color:var(--vino)">Ojo: ' + esc(avisos.join('; ')) + '.</p>';
    return h + '<button type="button" class="mas" data-a="agregarPiso">+ Agregar piso</button>';
  }
  function htmlTrabajo() {
    var P = CAT.P;
    function fm(k, t, s) { return '<div class="it"><div class="t"><div class="n" style="min-height:0">' + t + '</div><div class="s">' + s + '</div></div>' + stepper(k, Number(S[k]) || 0, 0, { ancho: true, label: t }) + '</div>'; }
    return fm('minBase', 'Trabajo base', 'Keke, relleno y armado de todo el pedido') +
      fm('minExtra', 'Decoración extra', 'Minutos además del nivel de diseño') +
      fm('minHorno', 'Horno', 'Minutos de horno (gas)') +
      fm('minBat', 'Batidora', 'Minutos de batidora (luz)') +
      '<p class="nota" id="minTotal"></p>' +
      '<p class="nota">Del maestro: tarifa ' + fmt(P.tarifa) + '/h · gastos fijos ' + fmt(P.gfHora) + '/h · margen ' + Math.round((P.margen || 0) * 1000) / 10 + ' % sobre precio · IGV ' + Math.round((P.igv || 0) * 100) + ' %.</p>';
  }
  function htmlRelleno() {
    var h = '';
    S.rellenos.forEach(function (r, i) {
      var cu = CAT.ingredientes[String(r.ingrediente).trim()];
      h += '<div class="it"><div class="t"><button type="button" class="n" data-a="elegirIng" data-i="' + i + '">' + (r.ingrediente ? esc(r.ingrediente) : '<span style="color:var(--tenue)">Elegir ingrediente</span>') + ICON_CHEV + '</button>' +
        '<div class="s">' + (cu != null ? fmt(cu) + ' por g · ' : '') + '<span data-rsub="' + i + '"></span></div></div>' +
        '<div class="monto"><input class="input" type="number" inputmode="decimal" placeholder="g" data-in="rCant" data-i="' + i + '" value="' + esc(r.cantidad) + '" aria-label="Gramos de ' + esc(r.ingrediente || 'ingrediente') + '"></div>' +
        '<button type="button" class="quitar" data-a="quitarRelleno" data-i="' + i + '" aria-label="Quitar ingrediente">✕</button></div>';
    });
    return h + '<button type="button" class="mas" data-a="agregarRelleno">+ Agregar ingrediente</button>';
  }
  function htmlExtras() {
    var h = '';
    S.extras.forEach(function (g, i) {
      var e0 = empaque(g.concepto);
      var tipo = /^Caja de torta/.test(g.concepto) || (e0 && e0.tipo === 'Caja') ? 'Caja' : (/^Base/.test(g.concepto) || (e0 && e0.tipo === 'Base') ? 'Base' : null);
      var nombre = tipo && (g.concepto === 'Caja de torta' || g.concepto === 'Base')
        ? '<button type="button" class="n" data-a="elegirEmp" data-v="' + tipo + '" data-i="' + i + '"><span style="color:var(--tenue)">Elegir ' + (tipo === 'Caja' ? 'caja' : 'base') + '</span>' + ICON_CHEV + '</button>'
        : (tipo ? '<button type="button" class="n" data-a="elegirEmp" data-v="' + tipo + '" data-i="' + i + '">' + esc(g.concepto) + ICON_CHEV + '</button>'
          : (e0 ? '<div class="n">' + esc(g.concepto) + '</div>' : '<input class="input" style="height:44px" data-in="gConcepto" data-i="' + i + '" value="' + esc(g.concepto) + '" placeholder="Concepto" aria-label="Concepto">'));
      var e = empaque(g.concepto);
      h += '<div class="it"><div class="t">' + nombre + (e ? '<div class="s">Catálogo: ' + fmt(e.precio) + (e.factura === false ? ' · sin factura' : '') + '</div>' : '') + '</div>' +
        '<div class="monto"><input class="input" type="number" inputmode="decimal" placeholder="S/" data-in="gCosto" data-i="' + i + '" value="' + esc(g.costo) + '" aria-label="Precio de ' + esc(g.concepto || 'extra') + '"></div>' +
        '<button type="button" class="quitar" data-a="quitarExtra" data-i="' + i + '" aria-label="Quitar">✕</button></div>';
    });
    var usados = S.extras.map(function (x) { return x.concepto; });
    h += '<div class="chips" data-k="extras" style="margin:12px -14px 0">' + SUGERIDOS.filter(function (n) {
      if (n === 'Caja de torta') return !usados.some(function (u) { return /^Caja de torta/.test(u) || empaqueTipo(u) === 'Caja'; });
      if (n === 'Base') return !usados.some(function (u) { return /^Base/.test(u) || empaqueTipo(u) === 'Base'; });
      return usados.indexOf(n) < 0;
    }).map(function (n) { return '<button type="button" class="chip" data-a="agregarExtra" data-v="' + esc(n) + '">+ ' + esc(corto(n)) + '</button>'; }).join('') +
      '<button type="button" class="chip" data-a="agregarExtra" data-v="">+ Otro</button></div>';
    return h;
  }
  function empaqueTipo(nombre) { var e = empaque(nombre); return e ? e.tipo : null; }

  function htmlProductos() {
    var cats = [['todos', 'Todos', '']];
    var bc = []; GRUPOS.boc.forEach(function (b) { var c = b.categoria || 'Otro'; if (bc.indexOf(c) < 0) bc.push(c); });
    bc.forEach(function (c) { cats.push(['boc:' + c, c + 's', 'c-boc']); });
    if (GRUPOS.tem.length) cats.push(['tem', 'Temáticos', 'c-tem']);
    if (GRUPOS.pos.length) cats.push(['pos', 'Postres', 'c-pos']);
    var h = '<div class="h3"><h2>Productos</h2><span id="prodCuenta"></span></div>' +
      '<div class="buscar">' + ICON_LUPA + '<input class="input" type="search" id="q" data-in="q" placeholder="Buscar bocaditos, temáticos o postres" value="' + esc(ui.q) + '" autocomplete="off" aria-label="Buscar productos"></div>' +
      '<div class="chips cats" data-k="cats">' + cats.map(function (c) {
        return '<button type="button" class="chip" data-a="cat" data-v="' + esc(c[0]) + '" aria-pressed="' + (ui.cat === c[0]) + '">' + (c[2] ? '<i class="petal p ' + c[2] + '"></i>' : '') + esc(c[1]) + '</button>';
      }).join('') + '</div><div id="prodLista">' + htmlListaProductos() + '</div>';
    return h;
  }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function htmlListaProductos() {
    var q = norm(ui.q);
    var lista = [];
    ['boc', 'tem', 'pos'].forEach(function (g) {
      GRUPOS[g].forEach(function (b) {
        if (ui.cat !== 'todos') {
          if (ui.cat.indexOf('boc:') === 0) { if (g !== 'boc' || (b.categoria || 'Otro') !== ui.cat.slice(4)) return; }
          else if (ui.cat !== g) return;
        }
        if (q && norm(b.nombre + ' ' + b.detalle + ' ' + b.categoria).indexOf(q) < 0) return;
        lista.push({ b: b, g: g });
      });
    });
    if (!lista.length) return '<p class="vacio">No hay productos con ese nombre.</p>';
    return lista.map(function (x) {
      var b = x.b, q2 = S.items[b.nombre] || 0;
      var col = x.g === 'boc' ? 'c-boc' : (x.g === 'tem' ? 'c-tem' : 'c-pos');
      var det = x.g === 'boc' ? 'Paquete de ' + b.unidades + ' u.' : (x.g === 'pos' && b.detalle ? b.detalle : 'Por unidad');
      return '<div class="prod' + (q2 ? ' on' : '') + '"><div class="t"><div class="n"><i class="petal p ' + col + '"></i>' + esc(b.nombre) + '</div>' +
        '<div class="d">' + esc(det) + ' · <b>' + fmt(b.precio) + '</b></div></div>' +
        (q2 ? stepper('item:' + b.nombre, q2, 0, { label: 'Cantidad de ' + b.nombre }) : '<button type="button" class="agregar" data-a="agregarItem" data-v="' + esc(b.nombre) + '">+ Agregar</button>') + '</div>';
    }).join('');
  }

  // ---------- vista: resumen ----------
  function lineasPedido() {
    var r = calc.r, p = payload(), out = [];
    if (S.conTorta) {
      var pisos = [{ sabor: S.sabor, forma: S.forma, tamano: S.tamano }].concat(S.pisos);
      var desc = pisos.length > 1 ? pisos.map(function (x, i) { return 'piso ' + (i + 1) + ': ' + x.sabor + ' ' + x.forma.toLowerCase() + ' ' + x.tamano; }).join(' · ')
        : S.forma.toLowerCase() + ' ' + S.tamano;
      out.push({ t: 'Torta' + (pisos.length > 1 ? ' de ' + pisos.length + ' pisos' : ' ' + S.sabor.toLowerCase()), total: r.precioRedondeado,
        b1: S.cantidad + ' × ' + desc + (S.nivel ? ' · ' + S.nivel.toLowerCase() : ''), b2: fmt(r.precioUnitario) + ' c/u' });
    }
    [['bocaditos', 'boc'], ['tematicos', 'tem'], ['postres', 'pos']].forEach(function (g) {
      (r[g[0]] && r[g[0]].lineas || []).forEach(function (l) {
        out.push({ t: l.nombre, total: l.total,
          b1: g[1] === 'boc' ? l.paquetes + ' paq. · ' + l.unidades + ' u.' : l.unidades + ' u.',
          b2: fmt(l.precioPaquete) + (g[1] === 'boc' ? ' c/paq.' : ' c/u') });
      });
    });
    return out;
  }
  function htmlResumen() {
    var r = calc.r;
    var est = S.estado === 'guardada' ? '<span class="estado ok">✓ Guardada</span>' : (S.estado === 'guardando' ? '<span class="estado">Guardando…</span>' : (S.estado === 'pendiente' ? '<span class="estado">Pendiente de envío</span>' : '<span class="estado">Sin guardar</span>'));
    var h = '<button type="button" class="volver" data-a="editar">' + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>Editar pedido</button>';
    if (S.conTorta && r.error) h += '<div class="aviso" style="margin:6px 0 10px">Sin costo de receta: ' + esc(r.error) + '</div>';
    h += '<div class="ticket"><div class="tk-h"><div><div class="c">' + (S.cliente ? esc(S.cliente) : 'Sin nombre') + '</div><div class="f">' + new Date().toLocaleDateString('es-PE', { day: 'numeric', month: 'long' }) + '</div></div>' + est + '</div>';
    lineasPedido().forEach(function (l) {
      h += '<div class="ln"><div class="a"><span>' + esc(l.t) + '</span><span>' + fmt(l.total) + '</span></div><div class="b"><span>' + esc(l.b1) + '</span><span>' + esc(l.b2) + '</span></div></div>';
    });
    h += '<div class="tot"><span>Total</span><strong>' + fmt(r.totalPedido) + '</strong></div><div class="igv">IGV incluido</div></div>';
    h += '<div class="acts"><button type="button" class="btn sec2" data-a="copiar">Copiar texto</button>' +
      '<button type="button" class="btn sec2" data-a="hojaCliente">Hoja para el cliente</button></div>';
    h += htmlNegocio();
    return h;
  }
  function htmlNegocio() {
    var r = calc.r, b = r.bocaditos, t = r.tematicos, po = r.postres;
    var ab = !!ui.abiertos.negocio;
    var h = '<div class="negocio"><button type="button" class="acc" data-a="acc" data-v="negocio" aria-expanded="' + ab + '"><span>Para el negocio</span>' + ICON_CHEV + '</button>';
    if (!ab) return h + '</div>';
    var gT = r.soloBocaditos ? 0 : (r.gananciaFamilia || 0), gB = b.gananciaFamilia || 0, gM = t.gananciaFamilia || 0, gP = po.gananciaFamilia || 0;
    var tot = gT + gB + gM + gP;
    function dl(a, v, cls) { return '<div class="dl' + (cls ? ' ' + cls : '') + '"><span>' + a + '</span><span>' + fmt(v) + '</span></div>'; }
    h += '<div class="fam"><div class="x"><span>Ganancia por pedido</span><strong>' + fmt(tot) + '</strong></div><small>Utilidad neta (después de renta) + mano de obra de Katherine' + (r.totalPedido > 0 ? ' · ' + Math.round(tot / r.totalPedido * 100) + ' %' : '') + '</small>' +
      (!r.soloBocaditos ? dl('Tortas', gT) : '') + (b.lineas.length ? dl('Bocaditos', gB) : '') + (t.lineas.length ? dl('Bocaditos temáticos', gM) : '') + (po.lineas.length ? dl('Postres', gP) : '') + '</div>';
    var pct = function (a, base) { return base > 0 ? Math.round(a / base * 100) + '%' : '—'; };
    var fila = function (lbl, v, cls) { return '<div class="pc-r' + (cls ? ' ' + cls : '') + '"><span>' + lbl + '</span><span>' + v + '</span></div>'; };
    var tarjeta = function (o) {
      var x = '<div class="pc"><div class="pc-h"><div><div class="pc-t">' + o.titulo + '</div>' + (o.sub ? '<div class="pc-s">' + esc(o.sub) + '</div>' : '') + '</div><div class="pc-p">' + fmt(o.precio) + '</div></div>';
      x += '<div class="pc-cap">De lo que cobras</div>';
      o.filas.forEach(function (f) { x += fila(f[0], '− ' + fmt(f[1]) + ' <i>' + pct(f[1], o.precio) + '</i>'); });
      x += fila('Utilidad neta del negocio', fmt(o.neta) + ' <i>' + pct(o.neta, o.precio) + '</i>', 'tot2');
      if (o.extra) x += '<div class="pc-nota">' + o.extra + '</div>';
      return x + '</div>';
    };
    if (!r.soloBocaditos) {
      var hrs = (r.minutos || 0) / 60;
      var red = (r.utilidadNeta || 0) + (r.renta || 0) - (r.margen || 0) - (r.prima || 0) - (r.margenExtras || 0);
      var p = payload();
      h += tarjeta({ titulo: S.cantidad > 1 ? S.cantidad + ' tortas' : 'Torta', precio: r.precioRedondeado || 0,
        sub: [p.sabor, [p.forma, p.tamano].join(' ').trim(), p.nivel].filter(Boolean).join(' · '),
        filas: [['IGV 18% (va a SUNAT)', r.igvFinal || 0], ['Insumos (keke + relleno)', (r.costoReceta || 0) + (r.relleno || 0)], ['Extras (caja, base, decoración, tercerizados)', r.extrasCosto || 0],
          ['Gastos fijos + gas y luz', r.costosFijos || 0], ['Mano de obra de Katherine (' + (r.minutos || 0) + ' min)', r.manoObra || 0], ['Renta RER 1.5%', r.renta || 0]],
        neta: r.utilidadNeta || 0, fam: r.gananciaFamilia || 0,
        extra: (hrs > 0 ? '<b>' + fmt((r.gananciaFamilia || 0) / hrs) + ' por hora</b> de trabajo de Katherine. ' : '') +
          'La utilidad sale de: margen ' + fmt(r.margen) + ' · prima por diseño ' + fmt(r.prima) + ' · gestión de extras ' + fmt(r.margenExtras) +
          (Math.abs(red) > 0.005 ? ' · redondeo del precio ' + (red > 0 ? '' : '− ') + fmt(Math.abs(red)) : '') + '.' });
    }
    var bocT = function (titulo, x, pc) {
      return tarjeta({ titulo: titulo, precio: x.total, sub: x.lineas.map(function (l) { return l.nombre + ' ' + l.unidades + ' u.'; }).join(' · '),
        filas: [['IGV 18% (va a SUNAT)', x.igv], [pc[1] ? pc[0] + ' (' + pc[1] + '% sin IGV)' : pc[0], x.costo], [pc[2] ? 'Mano de obra (' + pc[2] + '% sin IGV)' : 'Mano de obra de Katherine', x.manoObra], ['Renta RER 1.5%', x.renta]],
        neta: x.utilidadNeta, fam: x.gananciaFamilia });
    };
    if (b.lineas.length) h += bocT('Bocaditos', b, ['Insumos', 50, 20]);
    if (t.lineas.length) h += bocT('Bocaditos temáticos', t, ['Insumos', 40, 40]);
    if (po.lineas.length) h += bocT('Postres', po, ['Insumos, empaque, gastos fijos y gas (receta real)', 0, 0]);
    return h + '</div>';
  }

  // ---------- texto para el cliente (incluye pisos y cantidad) ----------
  function textoCliente() {
    var r = calc.r;
    var t = 'Cotización Dulzú\n' + (S.cliente ? 'Cliente: ' + S.cliente + '\n' : '');
    if (S.conTorta) {
      var pisos = [{ sabor: S.sabor, forma: S.forma, tamano: S.tamano }].concat(S.pisos);
      t += 'Torta' + (S.cantidad > 1 ? ' (' + S.cantidad + ' tortas iguales)' : '') + ': ';
      if (pisos.length > 1) t += '\n' + pisos.map(function (x, i) { return '  Piso ' + (i + 1) + ': ' + x.sabor + ' - ' + x.forma + ' ' + x.tamano; }).join('\n') + '\n  Precio: ';
      else t += S.sabor + ' - ' + S.forma + ' ' + S.tamano + ': ';
      t += fmt(r.precioRedondeado) + (S.cantidad > 1 ? ' (' + fmt(r.precioUnitario) + ' c/u)' : '') + '\n';
    }
    [].concat(r.bocaditos.lineas, r.tematicos.lineas, r.postres.lineas).forEach(function (l) { t += l.nombre + ' (' + l.unidades + ' u.): ' + fmt(l.total) + '\n'; });
    return t + 'Total: ' + fmt(r.totalPedido) + ' (IGV incluido)';
  }

  // ---------- guardar (en segundo plano, con cola y sin duplicados) ----------
  var COLA = leer(LS.cola, []);
  var enviando = false;
  function guardar() {
    if (calc.vacio) return;
    var c = calc;
    var rServidor = copia(c.r); rServidor.guardado = true;
    var item = { id: S.id, data: { id: S.id, payload: c.payload, r: rServidor, hist: c.hist, datos: c.datos } };
    COLA = COLA.filter(function (x) { return x.id !== item.id; }).concat([item]);
    guardarLS(LS.cola, COLA);
    S.estado = 'guardando'; guardarLS(LS.borrador, S);
    render();
    enviarCola();
  }
  function enviarCola() {
    if (enviando || !COLA.length) return;
    enviando = true;
    var item = COLA[0];
    var intento = function (n) {
      return apiPost('registrar', item.data).catch(function (err) {
        if (n > 0 && /conexión/.test(msgError(err))) return new Promise(function (ok) { setTimeout(ok, 2500); }).then(function () { return intento(n - 1); });
        throw err;
      });
    };
    intento(2).then(function (j) {
      COLA = COLA.filter(function (x) { return x.id !== item.id; }); guardarLS(LS.cola, COLA);
      enviando = false;
      if (S.id === item.id) { S.estado = 'guardada'; S.hojaUrl = j.hojaUrl || ''; guardarLS(LS.borrador, S); if (ui.tab === 'cotizar') render(); }
      toast('Cotización guardada en el Historial');
      HIST_FRESCO = false;
      enviarCola();
    }).catch(function (err) {
      enviando = false;
      var m = msgError(err);
      if (/conexión/.test(m)) {
        if (S.id === item.id) { S.estado = 'pendiente'; guardarLS(LS.borrador, S); if (ui.tab === 'cotizar') render(); }
        toast('Sin conexión: se guardará sola cuando vuelva la señal');
      } else {
        COLA = COLA.filter(function (x) { return x.id !== item.id; }); guardarLS(LS.cola, COLA);
        if (S.id === item.id) { S.estado = 'nueva'; guardarLS(LS.borrador, S); if (ui.tab === 'cotizar') render(); }
        toast('No se guardó: ' + m, 6000);
      }
    });
  }
  window.addEventListener('online', enviarCola);

  // ---------- historial ----------
  var HIST_FRESCO = false;
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function nombreMes(k) { var a = k.split('-'); return (MESES[Number(a[1]) - 1] || '') + ' ' + a[0]; }
  function lineasH(txt) {
    return String(txt || '').split('; ').map(function (s) {
      var m = s.trim().match(/^(.*) x(\d+(?:\.\d+)?) u\.: S\/([\d.]+)$/);
      return m ? { nombre: m[1], unidades: Number(m[2]), total: Number(m[3]) } : null;
    }).filter(Boolean);
  }
  function descripcionH(h) {
    var p = [];
    if (!h.solo) p.push((h.cantidad > 1 ? h.cantidad + ' tortas ' : 'Torta ') + [h.sabor, [h.forma, h.tamano].join(' ').trim()].filter(Boolean).join(' · '));
    lineasH(h.bocDet).concat(lineasH(h.temDet), lineasH(h.posDet)).forEach(function (l) { p.push(l.nombre + ' ' + l.unidades + ' u.'); });
    return p.join(' · ');
  }
  function cargarHistorial() {
    return apiGet({ api: 'historial' }).then(function (j) {
      HIST = j.data || []; guardarLS(LS.hist, HIST.slice(0, 400)); HIST_FRESCO = true;
      if (ui.tab === 'historial') renderHistorial();
    }).catch(function (err) {
      if (ui.tab === 'historial') { var e = $('histEstado'); if (e) e.textContent = 'No se pudo actualizar el historial: ' + msgError(err); }
    });
  }
  function filtradosH() {
    var q = norm(ui.hq);
    return HIST.filter(function (h) {
      if (ui.hmes && h.mes !== ui.hmes) return false;
      if (!ui.hpruebas && /prueba/i.test(h.cliente)) return false;
      if (!q) return true;
      return norm([h.cliente, h.sabor, h.forma, h.tamano, h.bocDet, h.temDet, h.posDet, h.fecha].join(' ')).indexOf(q) >= 0;
    });
  }
  function renderHistorial() {
    var meses = []; HIST.forEach(function (h) { if (h.mes && meses.indexOf(h.mes) < 0) meses.push(h.mes); });
    var h = '<div class="buscar" style="margin-top:6px">' + ICON_LUPA + '<input class="input" type="search" data-in="hq" placeholder="Buscar cliente, sabor o producto" value="' + esc(ui.hq) + '" autocomplete="off" aria-label="Buscar en el historial"></div>' +
      '<div class="chips cats" data-k="hmes"><button type="button" class="chip" data-a="hmes" data-v="" aria-pressed="' + (!ui.hmes) + '">Todos</button>' +
      meses.slice(0, 12).map(function (k) { return '<button type="button" class="chip" data-a="hmes" data-v="' + k + '" aria-pressed="' + (ui.hmes === k) + '">' + esc(nombreMes(k)) + '</button>'; }).join('') +
      '<button type="button" class="chip" data-a="hpruebas" aria-pressed="' + ui.hpruebas + '">Mostrar pruebas</button></div>' +
      '<p class="nota" id="histEstado">' + (HIST_FRESCO ? '' : 'Actualizando…') + '</p><div id="histLista">' + htmlListaH() + '</div>';
    var pos = guardarScrollFichas();
    $('main').innerHTML = h;
    restaurarScrollFichas(pos);
  }
  function htmlListaH() {
    var L = filtradosH(), vis = L.slice(0, ui.hn);
    if (!vis.length) return '<p class="vacio">' + (HIST.length ? 'No hay cotizaciones con ese filtro.' : (HIST_FRESCO ? 'Todavía no hay cotizaciones guardadas.' : '')) + '</p>';
    var hoy = new Date(), dd = function (d) { return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear(); };
    var ayer = new Date(hoy.getTime() - 86400000);
    var ultimoDia = '', out = '';
    vis.forEach(function (x) {
      var dia = String(x.fecha).slice(0, 10);
      var etq = dia === dd(hoy) ? 'Hoy' : (dia === dd(ayer) ? 'Ayer' : dia);
      if (etq !== ultimoDia) { out += '<p class="dia">' + esc(etq) + '</p>'; ultimoDia = etq; }
      var ab = ui.habierto === x.fila;
      out += '<div class="hi"><button type="button" class="hi-b" data-a="hAbrir" data-v="' + x.fila + '" aria-expanded="' + ab + '"><div class="t"><div class="n">' + (x.cliente ? esc(x.cliente) : 'Sin nombre') + '</div>' +
        '<div class="f">' + esc(String(x.fecha).slice(11)) + '</div><div class="d">' + esc(descripcionH(x)) + '</div></div><div class="p">' + fmt0(x.total) + '</div></button>' +
        (ab ? htmlDetalleH(x) : '') + '</div>';
    });
    if (L.length > vis.length) out += '<button type="button" class="mas" data-a="hMas">Ver más (' + (L.length - vis.length) + ')</button>';
    return out;
  }
  function htmlDetalleH(h) {
    var f = function (a, v, cls) { return '<div class="pc-r' + (cls ? ' ' + cls : '') + '"><span>' + a + '</span><span>' + v + '</span></div>'; };
    var d = '<div class="hi-det">';
    if (!h.solo) {
      d += '<div class="pc-cap">Torta</div>' + (h.cantidad > 1 ? f('Cantidad', h.cantidad + ' tortas') : '') + f('Sabor', esc(h.sabor)) + f('Forma y tamaño', esc([h.forma, h.tamano].join(' ')));
      if (h.relleno) d += f('Relleno y cobertura', esc(h.relleno));
      if (h.gastos) d += f('Extras', esc(h.gastos));
    }
    [['Bocaditos', h.bocDet], ['Bocaditos temáticos', h.temDet], ['Postres', h.posDet]].forEach(function (x) {
      var ls = lineasH(x[1]); if (!ls.length) return;
      d += '<div class="pc-cap">' + x[0] + '</div>' + ls.map(function (l) { return f(esc(l.nombre) + ' · ' + l.unidades + ' u.', fmt(l.total)); }).join('');
    });
    d += f('Total del pedido (IGV incluido)', fmt(h.total), 'tot2');
    if (h.fam > 0) d += '<div class="pc-fam"><span>Ganancia por pedido</span><b>' + fmt(h.fam) + (h.total > 0 ? ' · ' + Math.round(h.fam / h.total * 100) + '%' : '') + '</b></div>';
    d += '<div class="acts"><button type="button" class="btn sec2" data-a="hCargar" data-v="' + h.fila + '">Volver a cargar</button>' +
      '<button type="button" class="btn sec2" data-a="hHoja" data-v="' + h.fila + '">Hoja para el cliente</button></div><p class="nota" id="hHojaMsg"></p></div>';
    return d;
  }

  // Volver a cargar una cotización guardada (mismo criterio que el cotizador anterior)
  function payloadDesdeFila(h, avisos) {
    if (h.datos) { try { return JSON.parse(h.datos); } catch (e) { } }
    var p = { cliente: h.cliente, soloBocaditos: h.solo, pisos: [], rellenos: [], gastosExtra: [], cantidad: h.cantidad || 1 };
    if (!h.solo) {
      var formas = h.forma.split(' + '), tams = h.tamano.replace(/\s*\(\d+ pisos\)\s*$/, '').split(' + '), sabs = h.sabor.split(' / ');
      var lista = formas.map(function (f, i) { return { sabor: sabs[Math.min(i, sabs.length - 1)], forma: f, tamano: tams[i] || '' }; });
      if (formas.length > 1 && sabs.length > 1) avisos.push('Revisa el sabor de cada piso: en esta cotización solo quedó la lista de sabores.');
      p.sabor = lista[0].sabor; p.forma = lista[0].forma; p.tamano = lista[0].tamano; p.pisos = lista.slice(1);
      p.rellenos = h.relleno.split('; ').map(function (s) { var m = s.trim().match(/^(.*) \(([\d.]+)g\): S\/[\d.]+$/); return m ? { ingrediente: m[1], cantidad: m[2] } : null; }).filter(Boolean);
      p.gastosExtra = h.gastos.split('; ').map(function (s) { var m = s.trim().match(/^(.*): S\/([\d.]+)$/); return m ? { concepto: m[1], costo: m[2] } : null; }).filter(Boolean);
      if (h.tarifa >= 1 && h.manoObra > 0) {
        var minutos = Math.round(h.manoObra / h.tarifa * 60);
        var nv = CAT.niveles.slice().sort(function (a, b) { return a.min - b.min; })[0];
        p.nivel = nv ? nv.nombre : ''; p.minBase = Math.max(0, minutos - (nv ? nv.min : 0)); p.minExtra = 0;
        avisos.push('Esta cotización es anterior a que se guardara el formulario completo: quedaron ' + minutos + ' min de trabajo en total y el nivel de diseño "' + p.nivel + '". Ajusta el nivel si llevaba más diseño.');
      } else {
        avisos.push('Revisa el nivel de diseño y los minutos de trabajo: esta cotización no los guardó.');
      }
    }
    p.bocaditos = lineasH(h.bocDet).map(function (l) { var b = PROD[l.nombre]; return { nombre: l.nombre, paquetes: b ? Math.max(1, Math.round(l.unidades / b.b.unidades)) : 1 }; });
    p.tematicos = lineasH(h.temDet).map(function (l) { return { nombre: l.nombre, paquetes: l.unidades }; });
    p.postres = lineasH(h.posDet).map(function (l) { return { nombre: l.nombre, paquetes: l.unidades }; });
    return p;
  }
  function aplicarPayload(p, avisos) {
    var n = nuevaCotizacion();
    var I = CAT.init;
    function ok(lista, v, que) { if (v === undefined || v === null || v === '') return false; if (lista.indexOf(v) >= 0) return true; avisos.push(que + ' "' + v + '" ya no está en la lista: elígelo de nuevo.'); return false; }
    n.cliente = p.cliente || '';
    n.conTorta = !p.soloBocaditos;
    n.cantidad = Math.max(1, Math.round(Number(p.cantidad) || 1));
    if (n.conTorta) {
      if (ok(I.sabores, p.sabor, 'El sabor')) n.sabor = p.sabor;
      if (ok(I.formas, p.forma, 'La forma')) n.forma = p.forma;
      var tl = I.tamanosPorForma[n.forma] || [];
      n.tamano = ok(tl, p.tamano, 'El tamaño') ? p.tamano : (tl[0] || '');
      n.pisos = (p.pisos || []).map(function (x) {
        var y = { sabor: I.sabores[0], forma: I.formas[0], tamano: '' };
        if (ok(I.sabores, x.sabor, 'El sabor')) y.sabor = x.sabor;
        if (ok(I.formas, x.forma, 'La forma')) y.forma = x.forma;
        var t2 = I.tamanosPorForma[y.forma] || [];
        y.tamano = ok(t2, x.tamano, 'El tamaño') ? x.tamano : (t2[0] || '');
        return y;
      });
      if (p.nivel && ok(CAT.niveles.map(function (z) { return z.nombre; }), p.nivel, 'El nivel de diseño')) n.nivel = p.nivel;
      ['minBase', 'minExtra', 'minHorno', 'minBat'].forEach(function (k) { if (p[k] !== undefined && p[k] !== null && p[k] !== '') n[k] = Number(p[k]) || 0; });
      n.rellenos = (p.rellenos || []).filter(function (r) { return r.ingrediente; }).map(function (r) {
        if (CAT.ingredientes[String(r.ingrediente).trim()] === undefined) avisos.push('El ingrediente "' + r.ingrediente + '" ya no está en la lista: elígelo de nuevo.');
        return { ingrediente: r.ingrediente, cantidad: r.cantidad };
      });
      n.extras = (p.gastosExtra || []).filter(function (g) { return g.concepto; }).map(function (g) { return { concepto: g.concepto, costo: g.costo }; });
    }
    n.items = {};
    [].concat(p.bocaditos || [], p.tematicos || [], p.postres || []).forEach(function (x) {
      if (PROD[x.nombre]) n.items[x.nombre] = Number(x.paquetes) || 0;
      else avisos.push('"' + x.nombre + '" ya no está en el catálogo.');
    });
    return n;
  }

  // ---------- hoja inferior (selector) ----------
  var hojaActual = null;
  function abrirHoja(titulo, opciones, sel, alElegir, conBusqueda) {
    cerrarHoja();
    var velo = document.createElement('div'); velo.className = 'velo';
    velo.innerHTML = '<div class="hoja" role="dialog" aria-modal="true" aria-label="' + esc(titulo) + '"><div class="hoja-h"><h3>' + esc(titulo) + '</h3><button type="button" class="icono" data-h="cerrar" aria-label="Cerrar">✕</button></div>' +
      (conBusqueda ? '<div class="buscar">' + ICON_LUPA + '<input class="input" type="search" placeholder="Buscar" data-h="q" aria-label="Buscar"></div>' : '') +
      '<div class="hoja-l" role="listbox"></div></div>';
    document.body.appendChild(velo);
    hojaActual = velo;
    var lista = velo.querySelector('.hoja-l');
    function pintar(q) {
      q = norm(q);
      var fil = opciones.filter(function (o) { return !q || norm(o.label + ' ' + (o.sub || '')).indexOf(q) >= 0; });
      lista.innerHTML = fil.length ? fil.map(function (o, i) {
        return '<button type="button" class="op" role="option" data-h="op" data-v="' + esc(o.v) + '" aria-selected="' + (o.v === sel) + '"><span>' + esc(o.label) + '</span>' + (o.sub ? '<small>' + esc(o.sub) + '</small>' : '') + '</button>';
      }).join('') : '<p class="vacio" style="padding:12px 10px">Sin resultados.</p>';
    }
    pintar('');
    velo.addEventListener('click', function (e) {
      if (e.target === velo) { cerrarHoja(); return; }
      var b = e.target.closest('[data-h]'); if (!b) return;
      if (b.getAttribute('data-h') === 'cerrar') cerrarHoja();
      if (b.getAttribute('data-h') === 'op') { var v = b.getAttribute('data-v'); cerrarHoja(); alElegir(v); }
    });
    var qi = velo.querySelector('[data-h=q]');
    if (qi) qi.addEventListener('input', function () { pintar(qi.value); });
    var s = lista.querySelector('[aria-selected=true]'); if (s) s.scrollIntoView({ block: 'center' });
  }
  function cerrarHoja() { if (hojaActual) { hojaActual.remove(); hojaActual = null; } }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrarHoja(); });

  // ---------- avisos breves ----------
  var toastT = null;
  function toast(txt, ms, accion) {
    var t = $('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.innerHTML = '<span>' + esc(txt) + '</span>' + (accion ? '<button type="button">' + esc(accion.txt) + '</button>' : '');
    if (accion) t.querySelector('button').onclick = function () { accion.fn(); t.remove(); };
    clearTimeout(toastT); toastT = setTimeout(function () { if (t.parentNode) t.remove(); }, ms || 2600);
  }

  // ---------- eventos ----------
  function pulsar(el) { if (!el) return; el.classList.remove('pulso'); void el.offsetWidth; el.classList.add('pulso'); }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
    var a = b.getAttribute('data-a'), v = b.getAttribute('data-v'), i = Number(b.getAttribute('data-i'));
    var d = Number(b.getAttribute('data-d'));
    if (b.getAttribute('data-d')) { mover(a, d, b); return; }
    switch (a) {
      case 'ir': irA(v); break;
      case 'conTorta': S.conTorta = !S.conTorta; cambio(true); break;
      case 'elegirSabor':
        abrirHoja('Sabor', CAT.init.sabores.map(function (s) { return { v: s, label: s }; }), i < 0 ? S.sabor : S.pisos[i].sabor, function (val) {
          if (i < 0) S.sabor = val; else S.pisos[i].sabor = val; cambio(true);
        }); break;
      case 'forma': {
        var obj = i < 0 ? S : S.pisos[i];
        obj.forma = v; var tl = CAT.init.tamanosPorForma[v] || [];
        if (tl.indexOf(obj.tamano) < 0) obj.tamano = tl[0] || '';
        cambio(true); break; }
      case 'tamano': (i < 0 ? S : S.pisos[i]).tamano = v; cambio(true); break;
      case 'nivel': S.nivel = v; cambio(true); break;
      case 'acc': ui.abiertos[v] = !ui.abiertos[v]; render(); break;
      case 'agregarPiso': {
        var f0 = CAT.init.formas[0];
        S.pisos.push({ sabor: S.sabor, forma: S.forma || f0, tamano: (CAT.init.tamanosPorForma[S.forma || f0] || [])[0] || '' });
        cambio(true); break; }
      case 'quitarPiso': S.pisos.splice(i, 1); cambio(true); break;
      case 'agregarRelleno': S.rellenos.push({ ingrediente: '', cantidad: '' }); cambio(true); elegirIng(S.rellenos.length - 1); break;
      case 'elegirIng': elegirIng(i); break;
      case 'quitarRelleno': S.rellenos.splice(i, 1); cambio(true); break;
      case 'agregarExtra': {
        if (v === 'Caja de torta' || v === 'Base') { S.extras.push({ concepto: v, costo: '' }); cambio(true); elegirEmp(v === 'Base' ? 'Base' : 'Caja', S.extras.length - 1); }
        else { var e1 = empaque(v); S.extras.push({ concepto: v, costo: e1 ? e1.precio : '' }); cambio(true); if (!v) focoUltimo('gConcepto'); else if (!e1) focoUltimo('gCosto'); }
        break; }
      case 'elegirEmp': elegirEmp(v, i); break;
      case 'quitarExtra': S.extras.splice(i, 1); cambio(true); break;
      case 'cat': ui.cat = v; render(); break;
      case 'agregarItem': {
        S.items[v] = 1; cambio(true);
        var pr = PROD[v];
        toast(v + ' agregado · ' + fmt(pr.b.precio), 2600, { txt: 'Deshacer', fn: function () { delete S.items[v]; cambio(true); } });
        break; }
      case 'editar': ui.vista = 'armar'; render(); window.scrollTo(0, 0); break;
      case 'copiar': copiarTexto(textoCliente()); break;
      case 'hojaCliente': abrirHojaCliente(datosHojaCotizacion()); break;
      case 'cerrarCargada': S.cargada = null; guardarLS(LS.borrador, S); render(); break;
      case 'hmes': ui.hmes = v; ui.hn = 30; renderHistorial(); break;
      case 'hpruebas': ui.hpruebas = !ui.hpruebas; ui.hn = 30; renderHistorial(); break;
      case 'hMas': ui.hn += 30; $('histLista').innerHTML = htmlListaH(); break;
      case 'hAbrir': { var fila = Number(v); ui.habierto = ui.habierto === fila ? null : fila; $('histLista').innerHTML = htmlListaH(); break; }
      case 'hCargar': {
        var h = HIST.filter(function (x) { return x.fila === Number(v); })[0]; if (!h) return;
        var av = [];
        try { S = aplicarPayload(payloadDesdeFila(h, av), av); } catch (err) { av.push('Algo no se pudo cargar: ' + msgError(err)); }
        S.cargada = { cliente: h.cliente, fecha: h.fecha, total: h.total, avisos: av };
        ui.vista = 'armar'; recalcular(); location.hash = 'cotizar'; break; }
      case 'hHoja': {
        var hh = HIST.filter(function (x) { return x.fila === Number(v); })[0];
        if (hh) abrirHojaCliente(datosHojaHistorial(hh));
        break; }
    }
  });

  function mover(a, d, btn) {
    if (a === 'cantidad') { S.cantidad = Math.max(1, (S.cantidad || 1) + d); cambio(true); return; }
    if (/^min/.test(a)) { S[a] = Math.max(0, (Number(S[a]) || 0) + d * 5); cambio(false); actualizarInput(a, S[a]); return; }
    if (a.indexOf('item:') === 0) {
      var n = a.slice(5); var q = Math.max(0, (S.items[n] || 0) + d);
      if (q === 0) { delete S.items[n]; cambio(true); toast(n + ' quitado', 2600, { txt: 'Deshacer', fn: function () { S.items[n] = 1; cambio(true); } }); return; }
      S.items[n] = q; cambio(false); actualizarInput(a, q); return;
    }
  }
  function actualizarInput(a, val) {
    var inp = document.querySelector('[data-in="' + cssEsc(a) + '"]');
    if (!inp) return;
    inp.value = val; pulsar(inp);
    var w = inp.parentNode; var menos = w.querySelector('[data-d="-1"]');
    if (menos) menos.disabled = val <= Number(inp.getAttribute('min'));
  }
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }
  function focoUltimo(k) { setTimeout(function () { var l = document.querySelectorAll('[data-in="' + k + '"]'); if (l.length) l[l.length - 1].focus(); }, 30); }
  function elegirIng(i) {
    var ops = Object.keys(CAT.ingredientes).sort(function (a, b) { return a.localeCompare(b); }).map(function (n) { return { v: n, label: n, sub: fmt(CAT.ingredientes[n]) + '/g' }; });
    abrirHoja('Ingrediente', ops, S.rellenos[i].ingrediente, function (val) { S.rellenos[i].ingrediente = val; cambio(true); focoUltimoIdx('rCant', i); }, true);
  }
  function focoUltimoIdx(k, i) { setTimeout(function () { var el = document.querySelector('[data-in="' + k + '"][data-i="' + i + '"]'); if (el && !el.value) el.focus(); }, 30); }
  function elegirEmp(tipo, i) {
    var etiqueta = tipo === 'Caja' ? 'Caja de torta' : 'Base';
    var ops = (CAT.empaques || []).filter(function (e) { return e.tipo === tipo; }).map(function (e) { return { v: e.nombre, label: e.nombre, sub: fmt(e.precio) }; });
    ops.push({ v: etiqueta + ' (otra)', label: 'Otra (escribo el precio)' });
    abrirHoja(etiqueta, ops, S.extras[i].concepto, function (val) {
      var e = empaque(val); S.extras[i].concepto = val; S.extras[i].costo = e ? e.precio : '';
      cambio(true); if (!e) focoUltimoIdx('gCosto', i);
    }, ops.length > 8);
  }

  document.addEventListener('input', function (e) {
    var el = e.target, k = el.getAttribute('data-in'); if (!k) return;
    var i = Number(el.getAttribute('data-i'));
    if (k === 'cliente') { S.cliente = el.value; guardarLS(LS.borrador, S); if (S.estado !== 'nueva') { S.estado = 'nueva'; S.id = uid(); S.hojaUrl = ''; } return; }
    if (k === 'q') { ui.q = el.value; $('prodLista').innerHTML = htmlListaProductos(); return; }
    if (k === 'hq') { ui.hq = el.value; ui.hn = 30; $('histLista').innerHTML = htmlListaH(); return; }
    if (k === 'rCant') { S.rellenos[i].cantidad = el.value; cambio(false); return; }
    if (k === 'gCosto') { S.extras[i].costo = el.value; cambio(false); return; }
    if (k === 'gConcepto') {
      S.extras[i].concepto = el.value;
      var em = empaque(el.value.trim());
      if (em && (S.extras[i].costo === '' || S.extras[i].costo == null)) { S.extras[i].costo = em.precio; var ci = document.querySelector('[data-in="gCosto"][data-i="' + i + '"]'); if (ci) ci.value = em.precio; }
      cambio(false); return; }
    if (k === 'cantidad') { var c = Math.round(Number(el.value)); if (c >= 1) { S.cantidad = c; cambio(false); } return; }
    if (/^min/.test(k)) { if (el.value !== '' && Number(el.value) >= 0) { S[k] = Number(el.value); cambio(false); } return; }
    if (k.indexOf('item:') === 0) { var q = Math.round(Number(el.value)); if (q >= 1) { S.items[k.slice(5)] = q; cambio(false); } return; }
  });
  document.addEventListener('change', function (e) {
    var el = e.target, k = el.getAttribute('data-in'); if (!k) return;
    if (k === 'cantidad' || /^min/.test(k) || k.indexOf('item:') === 0) {
      if (el.value === '' || Number(el.value) < Number(el.getAttribute('min'))) { render(); return; }
      render();
    }
    if (k === 'gConcepto') render();
  });

  function copiarTexto(t) {
    var hecho = function () { toast('Texto copiado: pégalo en WhatsApp'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(hecho, function () { respaldoCopia(t); hecho(); });
    else { respaldoCopia(t); hecho(); }
  }
  function respaldoCopia(t) { var ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { } ta.remove(); }

  // Barra inferior
  $('barraBtn').addEventListener('click', function () {
    if (ui.vista === 'armar') { ui.vista = 'resumen'; render(); window.scrollTo(0, 0); return; }
    if (S.estado === 'nueva') { guardar(); return; }
    S = nuevaCotizacion(); ui.vista = 'armar'; ui.abiertos = {}; ui.q = ''; ui.cat = 'todos'; recalcular(); render(); window.scrollTo(0, 0);
    toast('Nueva cotización');
  });
  // Navegación: #cotizar y #historial; sin nada es el Inicio. El botón atrás del teléfono funciona solo.
  function aplicarRuta() {
    var r = (location.hash.match(/^#(cotizar|historial)\b/) || [])[1];
    ui.ruta = r ? 'herramienta' : 'inicio';
    if (r) ui.tab = r;
    cerrarHoja(); render(); window.scrollTo(0, 0);
    if (r === 'historial' && !HIST_FRESCO) cargarHistorial();
  }
  window.addEventListener('hashchange', function () { if (S) aplicarRuta(); });
  $('tabCotizar').addEventListener('click', function () { location.hash = 'cotizar'; });
  $('tabHist').addEventListener('click', function () { location.hash = 'historial'; });
  $('backBtn').addEventListener('click', function () { location.hash = ''; });

  // ---------- Inicio ----------
  var ICONOS = {
    cotizar: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    boleta: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
    hoja: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#EA7038" stroke-width="2" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/></svg>',
    carta: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#E66B8C" stroke-width="2" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    dashboard: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#1F6B3A" stroke-width="2" aria-hidden="true"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></svg>',
    registro: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#7A1432" stroke-width="2" aria-hidden="true"><path d="M4 4h16v16H4z"/><path d="M4 9h16M9 9v11"/></svg>',
    hojas: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#6F5036" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10M15 10v10"/></svg>'
  };
  function htmlInicio() {
    var T = [['cotizar', 'f coral', 'Cotizar', 'Torta y bocaditos'], ['boleta', 'f vino', 'Boleta', 'Registrar una venta'],
      ['hoja', 's', 'Hoja de cotización', 'PDF para el cliente'], ['carta', 's', 'Carta', 'Bocaditos vigentes'],
      ['dashboard', 's', 'Negocio', 'Ventas y ganancia'], ['registro', 's', 'Registro tributario', 'Compras, IGV y renta']];
    return '<div class="hola"><img src="monograma.svg" alt="Dulzú" width="52" height="52"><h1>Herramientas</h1></div><div class="grid">' +
      T.map(function (t) {
        return '<button type="button" class="card ' + t[1] + '" data-a="ir" data-v="' + t[0] + '"><span class="ic">' + ICONOS[t[0]] + '</span><span><b>' + t[2] + '</b><small>' + t[3] + '</small></span></button>';
      }).join('') +
      '<button type="button" class="card s ancha" data-a="ir" data-v="hojas"><span class="ic">' + ICONOS.hojas + '</span><span><b>Hojas de cálculo</b><small>Maestro, costos y registro</small></span></button></div>';
  }
  // ---------- Hoja de cotización para el cliente (hoja.html, dentro de la app) ----------
  function unicos(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); }
  function abrirHojaCliente(d) {
    guardarLS('dz_hoja_prefill', { id: uid(), d: d });
    location.href = 'hoja.html';
  }
  function datosHojaCotizacion() {
    var r = calc.r, d = { nombre: S.cliente || '', bocas: [] };
    if (S.conTorta) {
      var pisos = [{ sabor: S.sabor, forma: S.forma, tamano: S.tamano }].concat(S.pisos);
      var forma = pisos.length > 1 ? pisos.length + ' pisos · ' + pisos.map(function (x) { return x.forma.toLowerCase() + ' ' + x.tamano; }).join(' + ')
        : '1 piso · ' + S.forma.toLowerCase() + ' ' + S.tamano;
      d.pisos = (S.cantidad > 1 ? S.cantidad + ' tortas · ' : '') + forma;
      d.sabor = unicos(pisos.map(function (x) { return x.sabor; })).join(' / ');
      d.relleno = unicos(S.rellenos.filter(function (x) { return x.ingrediente && Number(x.cantidad) > 0; }).map(function (x) { return x.ingrediente; })).join(', ');
      d.precioTorta = (r.precioRedondeado || 0).toFixed(2);
    }
    [['bocaditos', 'boc'], ['tematicos', 'tem'], ['postres', 'pos']].forEach(function (g) {
      ((r[g[0]] && r[g[0]].lineas) || []).forEach(function (l) { d.bocas.push({ n: l.nombre, c: String(l.unidades), p: l.total.toFixed(2), g: g[1] }); });
    });
    return d;
  }
  function datosHojaHistorial(h) {
    var d = { nombre: h.cliente || '', bocas: [] };
    if (!h.solo) {
      var multi = /\(\d+ pisos\)/.test(h.tamano);
      var forma = multi ? (h.tamano.match(/\((\d+ pisos)\)/)[1] + ' · ' + h.forma.toLowerCase() + ' ' + h.tamano.replace(/\s*\(\d+ pisos\)\s*$/, ''))
        : '1 piso · ' + String(h.forma || '').toLowerCase() + ' ' + (h.tamano || '');
      d.pisos = (h.cantidad > 1 ? h.cantidad + ' tortas · ' : '') + forma;
      d.sabor = h.sabor || '';
      d.relleno = unicos(String(h.relleno || '').split('; ').map(function (s) { var m = s.trim().match(/^(.*) \(([\d.]+)g\)/); return m ? m[1] : ''; })).join(', ');
      d.precioTorta = (Number(h.precioTorta) || 0).toFixed(2);
    }
    [['bocDet', 'boc'], ['temDet', 'tem'], ['posDet', 'pos']].forEach(function (g) {
      lineasH(h[g[0]]).forEach(function (l) { d.bocas.push({ n: l.nombre, c: String(l.unidades), p: l.total.toFixed(2), g: g[1] }); });
    });
    return d;
  }

  function irA(v) {
    if (v === 'cotizar') { location.hash = 'cotizar'; return; }
    if (v === 'hoja') { location.href = 'hoja.html'; return; }
    if (v === 'boleta') { location.href = 'boleta.html'; return; }
    var e = (CAT && CAT.enlaces) || {};
    if (v === 'hojas') {
      if (!e.hojas) { toast('Cargando enlaces… intenta en unos segundos'); return; }
      abrirHoja('Hojas de cálculo', e.hojas.map(function (h) { return { v: h.url, label: h.nombre, sub: 'Abrir ↗' }; }), '', function (u) { window.open(u, '_blank', 'noopener'); });
      return;
    }
    if (!e[v]) { toast('Cargando enlaces… intenta en unos segundos'); return; }
    window.open(e[v], '_blank', 'noopener');
  }
  // Menú
  $('menuBtn').addEventListener('click', function () {
    var leido = CAT && CAT.leido ? new Date(CAT.leido) : null;
    abrirHoja('Más opciones', [
      { v: 'cat', label: 'Actualizar precios desde la hoja', sub: leido ? 'leídos ' + leido.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : '' },
      { v: 'nueva', label: 'Empezar cotización nueva' }
    ], '', function (v) {
      if (v === 'nueva') { S = nuevaCotizacion(); ui.vista = 'armar'; ui.tab = 'cotizar'; recalcular(); render(); }
      if (v === 'cat') {
        toast('Actualizando precios…', 9000);
        bajarCatalogo().then(function (c) { recalcular(); render(); toast(c ? 'Precios actualizados desde la hoja' : 'Los precios ya estaban al día'); })
          .catch(function (err) { toast('No se pudo actualizar: ' + msgError(err), 5000); });
      }
    });
  });
  // Sombra del encabezado al hacer scroll
  window.addEventListener('scroll', function () { $('top').classList.toggle('sombra', window.scrollY > 4); }, { passive: true });
  // Ocultar la barra mientras el teclado está abierto
  document.addEventListener('focusin', function (e) { if (e.target.matches && e.target.matches('input')) document.body.classList.add('teclado'); });
  document.addEventListener('focusout', function () { setTimeout(function () { if (!document.activeElement || !document.activeElement.matches('input')) document.body.classList.remove('teclado'); }, 60); });

  // ---------- inicio ----------
  function pantallaClave(error) {
    $('top').hidden = true; $('barra').hidden = true;
    $('main').innerHTML = '<div class="clave"><img src="' + 'monograma.svg' + '" alt="Dulzú"><h1>Herramientas</h1><p>Escribe la clave para conectar con las hojas de Dulzú.</p>' +
      '<input class="input" id="claveIn" autocomplete="off" autocapitalize="off" aria-label="Clave"><p class="nota" style="color:var(--vino)">' + esc(error || '') + '</p><button class="btn" id="claveBtn">Entrar</button></div>';
    $('claveBtn').onclick = function () { var v = $('claveIn').value.trim(); if (!v) return; KEY = v; try { localStorage.setItem(LS.key, v); } catch (e) { } arrancar(); };
  }
  function pantallaCarga(txt) { $('main').innerHTML = '<div class="clave"><img src="' + 'monograma.svg' + '" alt="Dulzú"><p style="margin-top:16px">' + esc(txt) + '</p></div>'; }

  function listo() {
    prepararCatalogo();
    S = leer(LS.borrador, null);
    if (!S || !S.id || !S.items) S = nuevaCotizacion();
    if (S.estado === 'guardando') S.estado = COLA.some(function (x) { return x.id === S.id; }) ? 'pendiente' : 'guardada';
    recalcular(); aplicarRuta();
    enviarCola();
  }
  function arrancar() {
    if (!KEY) { pantallaClave(''); return; }
    if (CAT) {
      listo();
      bajarCatalogo().then(function (c) { if (c) { recalcular(); render(); toast('Precios actualizados desde la hoja'); } }).catch(function () { });
    } else {
      pantallaCarga('Descargando precios y recetas… (solo la primera vez)');
      bajarCatalogo().then(listo).catch(function (err) {
        var m = msgError(err);
        if (/Clave/i.test(m)) pantallaClave('La clave no es correcta.');
        else pantallaCarga('No se pudo conectar con Google (' + m + '). Revisa tu internet y vuelve a abrir.');
      });
    }
  }
  window.DZApp = { estado: function () { return { S: S, calc: calc, ui: ui }; } };
  arrancar();
})();
