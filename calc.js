/* Dulzú · cálculo de cotizaciones en el celular.
   Copia fiel de CotizadorApp.gs (generarCotizacion, calcularBocaditos_, cotizarPedido)
   + reglas aprobadas el 30/10/2026:
     1) Cantidad de tortas iguales: solo el costo de receta se multiplica por la cantidad;
        relleno, extras y todos los minutos (incluidos los del nivel de diseño) son del pedido completo.
     2) El precio de la torta se redondea al sol entero más cercano.
   Este archivo no lee ni escribe Google Sheets: recibe el catálogo ya descargado (CAT). */
var DZCalc = (function () {
  'use strict';

  var SECCIONES = { Circular: 'MOLDES CIRCULARES', Rectangular: 'MOLDES RECTANGULARES', Cuadrado: 'MOLDES CUADRADOS' };

  function copia(x) { return JSON.parse(JSON.stringify(x)); }

  /** Igual que calcularCostoReceta del servidor, pero con las recetas ya leídas. */
  function costoReceta(CAT, sabor, forma, tamano) {
    var s = CAT.recetas[sabor];
    if (!s) return { ok: false, costo: 0, error: 'No se encontró la hoja de "' + sabor + '".' };
    if (s._err) return { ok: false, costo: 0, error: s._err };
    var seccion = SECCIONES[forma];
    if (!seccion) return { ok: false, costo: 0, error: 'Forma no reconocida.' };
    var f = s[forma];
    if (!f) return { ok: false, costo: 0, error: 'No se encontró la sección "' + seccion + '" en la hoja "' + sabor + '".' };
    var k = String(tamano).trim();
    if (!Object.prototype.hasOwnProperty.call(f, k)) return { ok: false, costo: 0, error: 'El tamaño "' + tamano + '" no existe para ' + sabor + ' (' + forma + ').' };
    if (f[k] === null) return { ok: false, costo: 0, error: 'No se encontró la fila "COSTO RECETA" para ' + sabor + ' (' + forma + ').' };
    return { ok: true, costo: f[k] };
  }

  function cantidadTortas(payload) {
    return Math.max(1, Math.round(Number(payload && payload.cantidad) || 1));
  }

  /** Igual que generarCotizacion del servidor, sin guardar. Modifica payload igual que el servidor. */
  function torta(CAT, payload) {
    var cant = cantidadTortas(payload);
    payload.cantidad = cant;
    var pisosLista = [{ sabor: payload.sabor, forma: payload.forma, tamano: payload.tamano }]
      .concat((payload.pisos || []).filter(function (p) { return p && p.sabor && p.forma && p.tamano; }));
    var pisosDetalle = [];
    var recetaResult = { ok: true, costo: 0, error: null };
    pisosLista.forEach(function (p, i) {
      var rr = costoReceta(CAT, p.sabor, p.forma, p.tamano);
      if (!rr.ok) {
        recetaResult.ok = false;
        recetaResult.error = (recetaResult.error ? recetaResult.error + ' ' : '') + (pisosLista.length > 1 ? 'Piso ' + (i + 1) + ': ' : '') + rr.error;
      }
      recetaResult.costo += Number(rr.costo) || 0;
      pisosDetalle.push('Piso ' + (i + 1) + ': ' + p.sabor + ' ' + p.forma + ' ' + p.tamano + ' (S/' + (Number(rr.costo) || 0).toFixed(2) + ')');
    });
    var costoRecetaUnidad = recetaResult.costo;
    var costoRecetaTotal = costoRecetaUnidad * cant;
    if (pisosLista.length > 1) {
      payload.sabor = pisosLista.map(function (p) { return p.sabor; }).filter(function (s, i, a) { return a.indexOf(s) === i; }).join(' / ');
      payload.forma = pisosLista.map(function (p) { return p.forma; }).join(' + ');
      payload.tamano = pisosLista.map(function (p) { return p.tamano; }).join(' + ') + ' (' + pisosLista.length + ' pisos)';
    }

    var ingredientesMap = CAT.ingredientes;
    var rellenos = (payload.rellenos || []).filter(function (r) { return r.ingrediente && Number(r.cantidad) > 0; });
    var rellenoDetalle = [];
    var totalRelleno = 0;
    rellenos.forEach(function (r) {
      var costoUnit = ingredientesMap[String(r.ingrediente).trim()] || 0;
      var cantidad = Number(r.cantidad) || 0;
      var subtotal = costoUnit * cantidad;
      totalRelleno += subtotal;
      rellenoDetalle.push(r.ingrediente + ' (' + cantidad + 'g): S/' + subtotal.toFixed(2));
    });

    var gastos = (payload.gastosExtra || []).filter(function (g) { return g.concepto && Number(g.costo) > 0; });
    var gastosDetalle = [];
    gastos.forEach(function (g) {
      var costo = Number(g.costo) || 0;
      gastosDetalle.push(g.concepto + ': S/' + costo.toFixed(2));
    });

    var P = CAT.P;
    var nivel = CAT.niveles.filter(function (n) { return n.nombre === payload.nivel; })[0] || { nombre: '', min: 0, prima: 0 };
    var minBase = Number(payload.minBase) || 0;
    var minExtra = Number(payload.minExtra) || 0;
    var minHorno = Number(payload.minHorno) || 0;
    var minBat = Number(payload.minBat) || 0;
    var minutos = minBase + nivel.min + minExtra;
    var r1 = costoRecetaTotal;
    var r2 = totalRelleno;
    var r3 = r1 + r2;
    var r7 = minutos / 60 * P.tarifa;
    var energia = minHorno / 60 * P.hornoHora + minBat / 60 * P.batHora;
    var gastosFijos = minutos / 60 * P.gfHora;
    var r4 = gastosFijos + energia;
    var r5 = (r3 + r7) * (1 + P.merma) + r4;
    var r6 = r5 / (1 - P.margen) - r5;
    var prima = (r5 + r6) * nivel.prima;
    var r8 = r5 + r6 + prima;
    var empMap = {}; CAT.empaques.forEach(function (e) { empMap[e.nombre] = e; });
    var totalGastosNeto = 0;
    gastos.forEach(function (gx) {
      var e = empMap[String(gx.concepto).trim()];
      var fac = (e && e.factura !== null) ? e.factura : P.factura;
      totalGastosNeto += (Number(gx.costo) || 0) / (fac ? 1 + P.igv : 1);
    });
    var r9 = totalGastosNeto / (1 - P.margenExtras);
    var r10 = r8 + r9;
    var r11 = Math.ceil(r10);
    var creditoFiscal = 0;
    var valorVenta = r10;
    var montoIGV = valorVenta * P.igv;
    var precioConIGV = valorVenta + montoIGV;
    var precioConIGVRedondeado = Math.round(Math.round(precioConIGV * 100) / 100);
    var valorVentaFinal = precioConIGVRedondeado / (1 + P.igv);
    var igvFinal = precioConIGVRedondeado - valorVentaFinal;
    var costoTotalPedido = r5 + totalGastosNeto;
    var margenExtras = r9 - totalGastosNeto;
    var utilidadAntesRenta = valorVentaFinal - costoTotalPedido;
    var rentaPedido = valorVentaFinal * P.renta;
    var utilidadNeta = utilidadAntesRenta - rentaPedido;
    var gananciaFamilia = utilidadNeta + r7;
    payload.pctFijos = P.gfHora; payload.pctMargen = P.margen; payload.pctManoObra = P.tarifa;

    return {
      ok: recetaResult.ok,
      pisosDetalle: pisosDetalle,
      error: recetaResult.error || null,
      costoReceta: r1,
      relleno: r2,
      costoBase: r3,
      costosFijos: r4,
      costoEstimado: r5,
      margen: r6,
      manoObra: r7,
      precioBruto: r8,
      gastosExtra: r9,
      precioFinal: r10,
      precioSinIGVRedondeado: r11,
      creditoFiscal: creditoFiscal,
      valorVenta: valorVenta,
      igv: montoIGV,
      precioConIGV: precioConIGV,
      precioRedondeado: precioConIGVRedondeado,
      rellenoDetalle: rellenoDetalle,
      gastosDetalle: gastosDetalle,
      prima: prima, minutos: minutos, nivel: nivel.nombre || '',
      extrasCosto: totalGastosNeto, costoTotalPedido: costoTotalPedido, margenExtras: margenExtras,
      utilidadAntesRenta: utilidadAntesRenta, renta: rentaPedido, utilidadNeta: utilidadNeta,
      gananciaFamilia: gananciaFamilia, igvFinal: igvFinal,
      cantidad: cant, costoRecetaUnidad: costoRecetaUnidad, precioUnitario: precioConIGVRedondeado / cant
    };
  }

  /** Igual que calcularBocaditos_ del servidor. */
  function bocaditos(CAT, items, P) {
    var cat = {}; CAT.bocaditos.forEach(function (b) { cat[b.nombre] = b; });
    var out = { lineas: [], total: 0, sinIGV: 0, igv: 0, costo: 0, manoObra: 0, utilidad: 0, renta: 0, utilidadNeta: 0, gananciaFamilia: 0 };
    (items || []).forEach(function (it) {
      var b = cat[String(it.nombre || '').trim()], paq = Number(it.paquetes) || 0;
      if (!b || paq <= 0) return;
      var l = { nombre: b.nombre, detalle: b.detalle, paquetes: paq, unidades: paq * b.unidades, precioPaquete: b.precio,
        total: b.precio * paq, sinIGV: b.sinIGV * paq, costo: b.costo * paq, manoObra: b.manoObra * paq, utilidad: b.utilidad * paq };
      out.lineas.push(l);
      out.total += l.total; out.sinIGV += l.sinIGV; out.costo += l.costo; out.manoObra += l.manoObra; out.utilidad += l.utilidad;
    });
    out.igv = out.total - out.sinIGV;
    out.renta = out.sinIGV * (P.renta || 0);
    out.utilidadNeta = out.utilidad - out.renta;
    out.gananciaFamilia = out.utilidadNeta + out.manoObra;
    return out;
  }

  /**
   * Igual que cotizarPedido del servidor, sin guardar.
   * Devuelve { r, payload (copia modificada como en el servidor), datos (JSON del formulario), hist }.
   * El formulario original (payloadIn) no se toca.
   */
  function cotizar(CAT, payloadIn) {
    var payload = copia(payloadIn);
    var P = CAT.P;
    var b = bocaditos(CAT, payload.bocaditos, P);
    var t = bocaditos(CAT, payload.tematicos, P);
    var po = bocaditos(CAT, payload.postres, P);
    var datos = JSON.stringify(payload);
    var solo = !!payload.soloBocaditos;
    if (solo && !b.lineas.length && !t.lineas.length && !po.lineas.length) {
      return { r: { ok: false, soloBocaditos: true, error: 'Elige al menos un bocadito o postre.', bocaditos: b, tematicos: t, postres: po, totalPedido: 0, gananciaFamiliaTotal: 0 },
        payload: payload, datos: datos, hist: null, vacio: true };
    }
    var hist = null;
    var r;
    if (solo) {
      r = { ok: true, soloBocaditos: true, precioRedondeado: 0, gananciaFamilia: 0, guardado: true };
    } else {
      r = torta(CAT, payload);
      hist = { payload: copia(payload), r: copia(r) };
      r.guardado = true;
    }
    r.soloBocaditos = solo;
    r.bocaditos = b;
    r.tematicos = t;
    r.postres = po;
    r.totalPedido = (r.precioRedondeado || 0) + b.total + t.total + po.total;
    r.gananciaFamiliaTotal = (r.gananciaFamilia || 0) + b.gananciaFamilia + t.gananciaFamilia + po.gananciaFamilia;
    return { r: r, payload: payload, datos: datos, hist: hist };
  }

  return { costoReceta: costoReceta, torta: torta, bocaditos: bocaditos, cotizar: cotizar };
})();
if (typeof module !== 'undefined') module.exports = DZCalc;
