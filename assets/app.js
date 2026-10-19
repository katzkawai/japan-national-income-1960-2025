/* ==========================================================================
   日本の国民所得 1960–2025 — 可視化ロジック
   データ: data/data.js（scripts/fetch_data.py が生成）
   ========================================================================== */
(function () {
  'use strict';

  window.addEventListener('error', function (e) {
    const box = document.getElementById('findings-list');
    if (box && !box.children.length) {
      box.innerHTML =
        '<li>可視化の読み込みに失敗しました。ページを再読み込みしてください。（' + e.message + '）</li>';
    }
    console.error(e.error || e.message);
  });

  const D = window.NATIONAL_INCOME_DATA;
  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!D) {
    document.getElementById('kpi-grid').innerHTML =
      '<p class="kpi-foot">データファイル（data/data.js）を読み込めませんでした。</p>';
    return;
  }

  /* ---------- データへのアクセサ ---------- */
  const YEARS = D.years;
  const S = D.series;
  const YEAR_INDEX = new Map(YEARS.map((y, i) => [y, i]));
  const at = (key, year) => {
    const i = YEAR_INDEX.get(year);
    const v = i === undefined ? null : S[key][i];
    return v === null || v === undefined ? null : v;
  };
  const seriesValues = (key) => S[key];
  const lastOf = (key) => {
    for (let i = YEARS.length - 1; i >= 0; i--) {
      if (S[key][i] !== null && S[key][i] !== undefined) return { year: YEARS[i], value: S[key][i] };
    }
    return null;
  };
  const SHARE = D.world.japan_share_pct;
  const lastVal = (arr) => {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] !== null && arr[i] !== undefined) return { year: YEARS[i], value: arr[i] };
    }
    return null;
  };
  const peakVal = (arr) => {
    let best = null;
    YEARS.forEach((y, i) => {
      const v = arr[i];
      if (v !== null && v !== undefined && (!best || v > best.value)) best = { year: y, value: v };
    });
    return best;
  };
  const peakOf = (key) => {
    let best = null;
    YEARS.forEach((y, i) => {
      const v = S[key][i];
      if (v !== null && v !== undefined && (!best || v > best.value)) best = { year: y, value: v };
    });
    return best;
  };

  /* ---------- 整形ユーティリティ ---------- */
  const NF = new Intl.NumberFormat('ja-JP');
  const nf1 = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

  const trimNum = (v, digits = 1) => {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    const abs = Math.abs(v);
    if (abs >= 1000) return NF.format(Math.round(v));
    return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: digits }).format(v);
  };
  const fmtTrillionYen = (v) => (v === null ? '—' : nf1.format(v / 1e12) + '兆円');
  const fmtTrillionUsd = (v) => (v === null ? '—' : nf2.format(v / 1e12) + '兆ドル');
  const fmtUsd = (v) => (v === null ? '—' : NF.format(Math.round(v)) + 'ドル');
  const fmtPct = (v, d = 1) => (v === null || v === undefined ? '—' : v.toFixed(d) + '%');
  const fmtSignedPct = (v, d = 1) => (v === null || v === undefined ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%');
  const fmtYear = (y) => y + '年';

  const pctChange = (a, b) => (a === null || b === null || !a ? null : (b / a - 1) * 100);

  /* ---------- 配色（テーマ別） ---------- */
  function palette() {
    const dark = root.getAttribute('data-theme') === 'dark';
    return dark
      ? {
          ink: '#edeae4', ink2: '#c6cad2', muted: '#98a0ad', grid: '#272c35', line: '#3a414d',
          japan: '#7b96ff', china: '#f0917f', usa: '#97a1b0', ppp: '#4fd1b0', fx: '#e0b256',
          good: '#4fd1b0', bad: '#f0917f', amber: '#e0b256', surface: '#171b22',
          tooltipBg: '#1f2530', band1: 'rgba(123,150,255,.07)', band2: 'rgba(224,178,86,.06)', band3: 'rgba(240,145,127,.055)',
          swatch1: 'rgba(123,150,255,.55)', swatch2: 'rgba(224,178,86,.55)', swatch3: 'rgba(240,145,127,.5)',
          fillTop: 'rgba(123,150,255,.28)', fillBottom: 'rgba(123,150,255,0)',
        }
      : {
          ink: '#14161b', ink2: '#3b414c', muted: '#6b7280', grid: '#e5e1d9', line: '#cdc7bb',
          japan: '#1f4fd8', china: '#c0392b', usa: '#6b7280', ppp: '#0d7c66', fx: '#b07d14',
          good: '#0d7c66', bad: '#b03a2e', amber: '#b07d14', surface: '#ffffff',
          tooltipBg: '#14161b', band1: 'rgba(31,79,216,.055)', band2: 'rgba(176,125,20,.055)', band3: 'rgba(176,58,46,.045)',
          swatch1: 'rgba(31,79,216,.5)', swatch2: 'rgba(176,125,20,.5)', swatch3: 'rgba(176,58,46,.45)',
          fillTop: 'rgba(31,79,216,.22)', fillBottom: 'rgba(31,79,216,0)',
        };
  }

  /* ---------- Chart.js 既定値 ---------- */
  if (window.Chart) {
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 11.5;
    if (reduceMotion) Chart.defaults.animation = false;
    Chart.defaults.plugins.tooltip.enabled = true;
  }

  /* ---------- 独自プラグイン ---------- */

  // 期間の帯（背景）
  const eraBands = {
    id: 'eraBands',
    beforeDatasetsDraw(chart) {
      const bands = chart.options.plugins.eraBands && chart.options.plugins.eraBands.bands;
      if (!bands) return;
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.x) return;
      ctx.save();
      bands.forEach((b) => {
        const x1 = Math.max(chartArea.left, scales.x.getPixelForValue(b.from));
        const x2 = Math.min(chartArea.right, scales.x.getPixelForValue(b.to));
        if (x2 <= x1) return;
        ctx.fillStyle = b.color;
        ctx.fillRect(x1, chartArea.top, x2 - x1, chartArea.bottom - chartArea.top);
        ctx.strokeStyle = b.color.replace(/[\d.]+\)$/, '0.18)');
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1 + 0.5, chartArea.top);
        ctx.lineTo(x1 + 0.5, chartArea.bottom);
        ctx.stroke();
      });
      // 帯ラベル（上端）
      ctx.font = '600 10px ' + Chart.defaults.font.family;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      bands.forEach((b) => {
        const x1 = Math.max(chartArea.left, scales.x.getPixelForValue(b.from));
        const x2 = Math.min(chartArea.right, scales.x.getPixelForValue(b.to));
        if (x2 - x1 < 44) return;
        ctx.fillStyle = b.labelColor;
        ctx.fillText(b.label, (x1 + x2) / 2, chartArea.top + 6);
      });
      ctx.restore();
    },
  };

  // 特定の年の点を強調
  const markPoints = {
    id: 'markPoints',
    afterDatasetsDraw(chart) {
      const marks = chart.options.plugins.markPoints && chart.options.plugins.markPoints.points;
      if (!marks) return;
      const { ctx, chartArea, scales } = chart;
      if (!chartArea) return;
      ctx.save();
      marks.forEach((m) => {
        const x = scales.x.getPixelForValue(m.x);
        const axis = m.axis && scales[m.axis] ? scales[m.axis] : scales.y;
        const y = axis.getPixelForValue(m.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = m.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = chart.options.plugins.markPoints.ring;
        ctx.stroke();

        const align = m.align || 'left';
        const dx = align === 'left' ? 10 : align === 'right' ? -10 : 0;
        const dy = m.dy === undefined ? -12 : m.dy;
        ctx.font = '600 10.5px ' + Chart.defaults.font.family;
        ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';
        ctx.textBaseline = 'bottom';
        const lines = m.label.split('\n');
        lines.forEach((line, i) => {
          ctx.fillStyle = m.color;
          ctx.fillText(line, x + dx, y + dy - (lines.length - 1 - i) * 13);
        });
      });
      ctx.restore();
    },
  };

  // 棒グラフの値ラベル
  const barValues = {
    id: 'barValues',
    afterDatasetsDraw(chart) {
      const cfg = chart.options.plugins.barValues;
      if (!cfg || !cfg.display) return;
      const meta = chart.getDatasetMeta(0);
      const { ctx } = chart;
      ctx.save();
      ctx.font = '600 10.5px ' + Chart.defaults.font.family;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      meta.data.forEach((bar, i) => {
        const v = chart.data.datasets[0].data[i];
        if (v === null || v === undefined) return;
        ctx.fillStyle = cfg.color;
        ctx.fillText(v.toFixed(1) + '%', bar.x, bar.y - 5);
      });
      ctx.restore();
    },
  };

  const plugins = [eraBands, markPoints, barValues];

  /* ---------- チャート生成の共通部 ---------- */
  let charts = [];

  function baseOptions(t) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 650, easing: 'easeOutQuart' },
      layout: { padding: { top: 14, right: 10, bottom: 2, left: 2 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: t.tooltipBg,
          titleColor: '#ffffff',
          bodyColor: 'rgba(255,255,255,.88)',
          borderColor: t.line,
          borderWidth: 0,
          padding: 11,
          cornerRadius: 9,
          titleFont: { weight: '700', size: 12 },
          bodyFont: { size: 12 },
          boxWidth: 8,
          boxHeight: 8,
          usePointStyle: true,
          callbacks: {
            title: (items) => (items.length ? items[0].label || '' : ''),
          },
        },
      },
      scales: {},
    };
  }

  function lineStyle(color, width = 2.2) {
    return {
      borderColor: color,
      backgroundColor: color,
      borderWidth: width,
      pointRadius: 0,
      pointHoverRadius: 4.5,
      pointHoverBorderWidth: 2,
      pointHoverBorderColor: '#fff',
      tension: 0.28,
      spanGaps: true,
    };
  }

  function xYearScale(t, opts = {}) {
    return {
      type: 'linear',
      min: opts.min || 1960,
      max: opts.max || 2025,
      offset: false,
      grid: { display: false, drawBorder: false },
      border: { color: t.grid },
      ticks: {
        stepSize: opts.step || 10,
        callback: (v) => (v >= (opts.min || 1960) && v <= (opts.max || 2025) ? String(v) : ''),
        color: t.muted,
        font: { size: 10.5 },
        maxRotation: 0,
        autoSkip: false,
      },
      afterBuildTicks: (axis) => {
        const out = [];
        for (let y = opts.min || 1960; y <= (opts.max || 2025); y += opts.step || 10) out.push({ value: y });
        axis.ticks = out;
        return out;
      },
    };
  }

  function yScale(t, opts = {}) {
    const scale = {
      position: opts.position || 'left',
      grid: {
        color: t.grid,
        drawTicks: false,
        lineWidth: 1,
      },
      border: { display: false },
      ticks: {
        color: t.muted,
        font: { size: 10.5 },
        padding: 6,
        callback: opts.callback || ((v) => NF.format(v)),
        maxTicksLimit: opts.maxTicks || 6,
      },
      title: opts.title
        ? { display: true, text: opts.title, color: t.muted, font: { size: 10.5, weight: '500' }, padding: { bottom: 4 } }
        : { display: false },
    };
    if (opts.beginAtZero) scale.beginAtZero = true;
    if (opts.suggestedMin !== undefined) scale.suggestedMin = opts.suggestedMin;
    if (opts.suggestedMax !== undefined) scale.suggestedMax = opts.suggestedMax;
    if (opts.reverse) scale.reverse = true;
    if (opts.type) scale.type = opts.type;
    return scale;
  }

  function gradientFill(ctx, area, t) {
    const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, t.fillTop);
    g.addColorStop(1, t.fillBottom);
    return g;
  }

  /* ---------- 1. 実質GDP指数 ---------- */
  function chartReal(t) {
    const base = seriesValues('gdp_const_usd').find((v) => v !== null);
    const data = YEARS.map((y) => {
      const v = at('gdp_const_usd', y);
      return v === null ? null : (v / base) * 100;
    });

    const opts = baseOptions(t);
    opts.scales.x = xYearScale(t);
    opts.scales.y = Object.assign(yScale(t, { callback: (v) => NF.format(v) }), {
      type: 'logarithmic',
      min: 80,
      max: 1000,
      afterBuildTicks: (axis) => {
        axis.ticks = [100, 200, 400, 800].map((v) => ({ value: v }));
        return axis.ticks;
      },
      grid: { color: t.grid, drawTicks: false },
    });
    opts.plugins.legend = { display: false };
    opts.plugins.eraBands = {
      bands: [
        { from: 1960, to: 1973, label: '高度成長', color: t.band1, labelColor: t.muted, swatch: t.swatch1 },
        { from: 1974, to: 1990, label: '安定成長', color: t.band2, labelColor: t.muted, swatch: t.swatch2 },
        { from: 1991, to: 2025, label: '低成長', color: t.band3, labelColor: t.muted, swatch: t.swatch3 },
      ],
    };
    opts.plugins.tooltip.callbacks.label = (item) => '実質GDP指数 ' + nf1.format(item.parsed.y);

    const ctx = document.getElementById('chart-real').getContext('2d');
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [Object.assign({ label: '実質GDP（1960年=100）', data }, lineStyle(t.japan, 2.4), {
          fill: true,
          backgroundColor: (c) => {
            const { ctx: cx, chartArea } = c.chart;
            return chartArea ? gradientFill(cx, chartArea, t) : t.fillTop;
          },
        })],
      },
      options: opts,
      plugins,
    });
    charts.push(chart);

    const legend = document.getElementById('legend-era');
    if (legend) {
      legend.innerHTML = opts.plugins.eraBands.bands
        .map(
          (b) =>
            `<span class="legend-item"><span class="legend-swatch" style="background:${b.swatch};border:1px solid ${t.line}"></span>${b.label}期 ${b.from}–${b.to}</span>`
        )
        .join('');
    }
  }

  /* ---------- 2. 10年平均成長率 ---------- */
  function chartDecades(t) {
    const labels = D.decades.map((d) => d.label);
    const values = D.decades.map((d) => d.avg_growth);
    const colors = D.decades.map((d, i) =>
      i === D.decades.length - 1 ? (root.getAttribute('data-theme') === 'dark' ? 'rgba(123,150,255,.45)' : 'rgba(31,79,216,.35)') : t.japan
    );

    const opts = baseOptions(t);
    opts.scales.x = {
      grid: { display: false, drawBorder: false },
      border: { color: t.grid },
      ticks: { color: t.muted, font: { size: 10 }, maxRotation: 0, autoSkip: false },
    };
    opts.scales.y = yScale(t, { beginAtZero: true, suggestedMax: 12, callback: (v) => v + '%' });
    opts.interaction = { mode: 'index', intersect: true };
    opts.plugins.barValues = { display: true, color: t.ink2 };
    opts.plugins.tooltip.callbacks.label = (item) => '年平均成長率 ' + fmtSignedPct(item.parsed.y, 2);

    const ctx = document.getElementById('chart-decades').getContext('2d');
    charts.push(new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: '年平均実質成長率', data: values, backgroundColor: colors, borderRadius: 5, borderSkipped: false, maxBarThickness: 46 }] },
      options: opts,
      plugins,
    }));
  }

  /* ---------- 3. 名目GDP（円建て・ドル建て） ---------- */
  function chartNominal(t) {
    const yen = seriesValues('gdp_jpy').map((v) => (v === null ? null : v / 1e12));
    const usd = seriesValues('gdp_usd').map((v) => (v === null ? null : v / 1e12));
    const peak = peakOf('gdp_usd');
    const fx2012 = at('fx_jpy_usd', peak.year);

    const opts = baseOptions(t);
    opts.scales.x = xYearScale(t);
    opts.scales.y = yScale(t, {
      position: 'left',
      suggestedMin: 0,
      suggestedMax: 720,
      callback: (v) => NF.format(v) + '兆円',
    });
    opts.scales.y1 = yScale(t, {
      position: 'right',
      suggestedMin: 0,
      suggestedMax: 7,
      callback: (v) => v.toFixed(1) + '兆$',
    });
    opts.scales.y.grid.color = t.grid;
    opts.scales.y1.grid = { display: false, drawTicks: false };
    opts.plugins.legend = {
      display: true,
      position: 'bottom',
      align: 'start',
      labels: { color: t.ink2, boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'line', padding: 16, font: { size: 11 } },
    };
    opts.plugins.markPoints = {
      ring: t.surface,
      points: [{ x: peak.year, y: peak.value / 1e12, axis: 'y1', label: 'ドル建てのピーク', color: t.usa, align: 'left', dy: -6 }],
    };
    opts.plugins.tooltip.callbacks.label = (item) =>
      item.dataset.yAxisID === 'y1'
        ? 'ドル建て ' + nf2.format(item.parsed.y) + '兆ドル'
        : '円建て ' + nf1.format(item.parsed.y) + '兆円';

    const ctx = document.getElementById('chart-nominal').getContext('2d');
    charts.push(new Chart(ctx, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          Object.assign({ label: '名目GDP（円建て）', data: yen, yAxisID: 'y' }, lineStyle(t.japan, 2.4)),
          Object.assign({ label: '名目GDP（ドル建て）', data: usd, yAxisID: 'y1' }, lineStyle(t.usa, 2.2), { borderDash: [5, 3] }),
        ],
      },
      options: opts,
      plugins,
    }));

    const note = document.getElementById('fx-note');
    if (note) {
      note.textContent =
        '円建ては期間平均為替レートで換算した参考値。' +
        `1960年は1ドル＝${at('fx_jpy_usd', 1960).toFixed(0)}円、ドル建てがピークの${peak.year}年は${fx2012.toFixed(1)}円、` +
        `${lastOf('fx_jpy_usd').year}年は${lastOf('fx_jpy_usd').value.toFixed(1)}円。`;
    }
  }

  /* ---------- 4. 1人当たりGNI ---------- */
  function chartPerCapita(t) {
    const nominal = seriesValues('gni_pc_usd');
    const ppp = seriesValues('gni_pc_ppp');
    const peak = peakOf('gni_pc_usd');

    const opts = baseOptions(t);
    opts.scales.x = xYearScale(t);
    opts.scales.y = yScale(t, {
      suggestedMin: 0,
      suggestedMax: 64000,
      callback: (v) => (v >= 1000 ? NF.format(v / 1000) + 'k' : v),
    });
    opts.plugins.legend = {
      display: true, position: 'bottom', align: 'start',
      labels: { color: t.ink2, boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'line', padding: 16, font: { size: 11 } },
    };
    opts.plugins.markPoints = {
      ring: t.surface,
      points: [{ x: peak.year, y: peak.value, label: `ピーク ${NF.format(peak.value)}ドル`, color: t.japan, align: 'right', dy: -8 }],
    };
    opts.plugins.tooltip.callbacks.label = (item) => item.dataset.label + ' ' + fmtUsd(item.parsed.y);

    const ctx = document.getElementById('chart-percapita').getContext('2d');
    charts.push(new Chart(ctx, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          Object.assign({ label: '為替換算', data: nominal }, lineStyle(t.japan, 2.4)),
          Object.assign({ label: '購買力平価（PPP）', data: ppp }, lineStyle(t.ppp, 2.2), { borderDash: [5, 3] }),
        ],
      },
      options: opts,
      plugins,
    }));
  }

  /* ---------- 5. 対米比率 ---------- */
  const usRatioSeries = () => {
    const jp = seriesValues('gdp_pc_ppp');
    const us = D.compare.gdp_pc_ppp.USA;
    return YEARS.map((y, i) => (jp[i] && us[i] ? (jp[i] / us[i]) * 100 : null));
  };

  function chartVsUS(t) {
    const ratio = usRatioSeries();
    const first = ratio.find((v) => v !== null);
    const firstIdx = ratio.findIndex((v) => v !== null);
    const lastIdx = ratio.length - 1 - [...ratio].reverse().findIndex((v) => v !== null);
    const lastV = ratio[lastIdx];

    const opts = baseOptions(t);
    opts.scales.x = xYearScale(t, { min: 1990 });
    opts.scales.y = yScale(t, { suggestedMin: 50, suggestedMax: 95, callback: (v) => v + '%' });
    opts.plugins.tooltip.callbacks.label = (item) => '対米比率 ' + nf1.format(item.parsed.y) + '%';

    const ctx = document.getElementById('chart-vsus').getContext('2d');
    charts.push(new Chart(ctx, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [Object.assign({ label: '1人当たりGDP（PPP）の対米比率', data: ratio }, lineStyle(t.japan, 2.4), {
          fill: true,
          backgroundColor: (c) => {
            const { ctx: cx, chartArea } = c.chart;
            return chartArea ? gradientFill(cx, chartArea, t) : t.fillTop;
          },
        })],
      },
      options: opts,
      plugins,
    }));

    const foot = document.getElementById('vsus-foot');
    if (foot) {
      foot.innerHTML =
        `${YEARS[firstIdx]}年は米国の <strong>${nf1.format(first)}%</strong>、` +
        `${YEARS[lastIdx]}年は <strong>${nf1.format(lastV)}%</strong>。` +
        `差は${nf1.format(first - lastV)}ポイント縮まった。`;
    }
  }

  /* ---------- 6. 世界GDPシェア ---------- */
  function chartShare(t) {
    const world = D.world.gdp_usd;
    const shareOf = (code) =>
      D.compare.gdp_usd[code].map((v, i) => (v && world[i] ? (v / world[i]) * 100 : null));

    const opts = baseOptions(t);
    opts.scales.x = xYearScale(t);
    opts.scales.y = yScale(t, { beginAtZero: true, suggestedMax: 20, callback: (v) => v + '%' });
    opts.plugins.legend = {
      display: true, position: 'bottom', align: 'start',
      labels: { color: t.ink2, boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'line', padding: 16, font: { size: 11 } },
    };
    opts.plugins.tooltip.callbacks.label = (item) => item.dataset.label + ' ' + nf1.format(item.parsed.y) + '%';

    const ctx = document.getElementById('chart-share').getContext('2d');
    charts.push(new Chart(ctx, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          Object.assign({ label: '日本', data: shareOf('JPN') }, lineStyle(t.japan, 2.6), {
            fill: true,
            backgroundColor: (c) => {
              const { ctx: cx, chartArea } = c.chart;
              return chartArea ? gradientFill(cx, chartArea, t) : t.fillTop;
            },
          }),
          Object.assign({ label: '中国', data: shareOf('CHN') }, lineStyle(t.china, 2.4)),
        ],
      },
      options: opts,
      plugins,
    }));
  }

  /* ---------- 7. 世界順位 ---------- */
  function chartRank(t) {
    const years = D.rank.years;
    const ranks = D.rank.all;
    const maxRank = Math.max(...ranks.filter((v) => v !== null));

    const opts = baseOptions(t);
    opts.interaction = { mode: 'index', intersect: false };
    opts.scales.x = {
      grid: { display: false, drawBorder: false },
      border: { color: t.grid },
      ticks: { color: t.muted, font: { size: 10 }, maxRotation: 0, autoSkip: false },
    };
    opts.scales.y = Object.assign(
      yScale(t, { reverse: true, callback: (v) => v + '位', maxTicks: 5 }),
      { min: 1, max: Math.ceil((maxRank + 3) / 10) * 10 }
    );
    opts.plugins.legend = { display: false };
    opts.plugins.tooltip.callbacks.title = (items) => items[0].label;
    opts.plugins.tooltip.callbacks.label = (item) => {
      const i = item.dataIndex;
      return [
        '世界 ' + ranks[i] + '位',
        'OECD内 ' + D.rank.oecd[i] + '位',
        '（比較 ' + D.rank.coverage[i] + 'か国）',
      ];
    };

    const ctx = document.getElementById('chart-rank').getContext('2d');
    charts.push(new Chart(ctx, {
      type: 'line',
      data: {
        labels: years.map(String),
        datasets: [Object.assign({ label: '1人当たりGNI 世界順位', data: ranks }, lineStyle(t.japan, 2), {
          pointRadius: 3.6,
          pointBackgroundColor: t.japan,
          pointBorderColor: t.surface,
          pointBorderWidth: 1.5,
          pointHoverRadius: 5.5,
          tension: 0,
        })],
      },
      options: opts,
      plugins,
    }));

    const note = document.getElementById('rank-note');
    if (note) {
      const latest = years[years.length - 1];
      note.textContent =
        `順位が上にあるほど上位。${latest}年は${D.rank.coverage[years.length - 1]}か国で比較。` +
        '報告国が少ない速報年は除外しているため、年ごとの順位は厳密な比較ではない。';
    }
  }

  /* ---------- 8. 消費・投資 ---------- */
  function chartStructure(t) {
    const opts = baseOptions(t);
    opts.scales.x = xYearScale(t, { min: 1970 });
    opts.scales.y = yScale(t, { beginAtZero: true, suggestedMax: 60, callback: (v) => v + '%' });
    opts.plugins.legend = {
      display: true, position: 'bottom', align: 'start',
      labels: { color: t.ink2, boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'line', padding: 16, font: { size: 11 } },
    };
    opts.plugins.tooltip.callbacks.label = (item) => item.dataset.label + ' ' + nf1.format(item.parsed.y) + '%';

    const ctx = document.getElementById('chart-structure').getContext('2d');
    charts.push(new Chart(ctx, {
      type: 'line',
      data: {
        labels: YEARS,
        datasets: [
          Object.assign({ label: '家計最終消費支出（GDP比）', data: seriesValues('consumption_share') }, lineStyle(t.japan, 2.4)),
          Object.assign({ label: '総資本形成（GDP比）', data: seriesValues('capital_share') }, lineStyle(t.amber, 2.4)),
        ],
      },
      options: opts,
      plugins,
    }));
  }

  /* ---------- KPI ---------- */
  function renderKpis() {
    const realLast = lastOf('gdp_const_usd');
    const realBase = seriesValues('gdp_const_usd').find((v) => v !== null);
    const multiple = realLast.value / realBase;
    const usdPeak = peakOf('gdp_usd');
    const usdLast = lastOf('gdp_usd');
    const gniPeak = peakOf('gni_pc_usd');
    const gni2024 = at('gni_pc_usd', 2024);
    const sharePeak = peakVal(SHARE);
    const shareLast = lastVal(SHARE);

    const items = [
      {
        label: '実質GDP（' + realLast.year + '年）',
        value: nf2.format(realLast.value / 1e12),
        unit: '兆ドル',
        foot: `1960年比 <strong class="up">${nf1.format(multiple)}倍</strong>（2015年価格）`,
        tone: 'positive',
      },
      {
        label: '名目GDP ピーク比（ドル建て）',
        value: fmtSignedPct(pctChange(usdPeak.value, usdLast.value), 1),
        unit: '',
        foot: `${usdPeak.year}年 ${nf2.format(usdPeak.value / 1e12)}兆ドル → <strong>${nf2.format(usdLast.value / 1e12)}兆ドル</strong>`,
        tone: 'negative',
      },
      {
        label: '1人当たりGNI（2024年）',
        value: NF.format(Math.round(gni2024)),
        unit: 'ドル',
        foot: `${gniPeak.year}年のピーク ${NF.format(gniPeak.value)}ドルから <strong class="down">${fmtSignedPct(pctChange(gniPeak.value, gni2024))}</strong>`,
        tone: 'neutral',
      },
      {
        label: '世界GDPシェア（' + shareLast.year + '年）',
        value: nf1.format(shareLast.value),
        unit: '%',
        foot: `${sharePeak.year}年のピーク <strong>${nf1.format(sharePeak.value)}%</strong>`,
        tone: 'neutral',
      },
      {
        label: '1人当たりGNI 世界順位',
        value: String(D.stats.rank_all_today),
        unit: '位',
        foot: `1990年は <strong>${D.stats.rank_all_1990}位</strong>／OECD内 ${D.stats.rank_oecd_today}位`,
        tone: 'negative',
      },
    ];

    document.getElementById('kpi-grid').innerHTML = items
      .map(
        (k) => `
      <div class="kpi is-${k.tone}">
        <p class="kpi-label">${k.label}</p>
        <p class="kpi-value">${k.value}${k.unit ? `<span class="unit">${k.unit}</span>` : ''}</p>
        <p class="kpi-foot">${k.foot}</p>
      </div>`
      )
      .join('');
  }

  /* ---------- 分析（データから自動生成） ---------- */
  function renderFindings() {
    const chnShare = (year) => {
      const i = YEARS.indexOf(year);
      const w = D.world.gdp_usd[i];
      const c = D.compare.gdp_usd.CHN[i];
      return w && c ? (c / w) * 100 : 0;
    };
    const gniPeak = peakOf('gni_pc_usd');
    const usdPeak = peakOf('gdp_usd');
    const usdLast = lastOf('gdp_usd');
    const jpy1995 = at('gdp_jpy', 1995);
    const jpyLast = lastOf('gdp_jpy');
    const real1995 = at('gdp_const_usd', 1995);
    const realLast = lastOf('gdp_const_usd');
    const sharePeak = peakVal(SHARE);
    const shareLast = lastVal(SHARE);
    const d = D.decades;
    const ppp2024 = at('gni_pc_ppp', 2024);
    const gni2024 = at('gni_pc_usd', 2024);
    const popPeak = peakOf('population');
    const popLast = lastOf('population');
    const cons70 = at('consumption_share', 1970);
    const consLast = lastOf('consumption_share');
    const cap70 = at('capital_share', 1970);
    const capLast = lastOf('capital_share');
    const ratioSeries = usRatioSeries();
    const ratioFirstIdx = ratioSeries.findIndex((v) => v !== null);
    const ratioLastIdx = ratioSeries.length - 1 - [...ratioSeries].reverse().findIndex((v) => v !== null);
    const rFirst = ratioSeries[ratioFirstIdx];
    const rLast = ratioSeries[ratioLastIdx];
    const jpyPeak = peakOf('gdp_jpy');
    const realMultiple = realLast.value / seriesValues('gdp_const_usd').find((v) => v !== null);
    const cagr = (Math.pow(realMultiple, 1 / (realLast.year - 1960)) - 1) * 100;

    const rows = [
      `<strong>${realLast.year - 1960}年で実質GDPは${nf1.format(realMultiple)}倍。</strong>年平均${nf1.format(cagr)}%の成長だが、その大半は1973年までに達成された。1960年代の年平均成長率は<span class="num">${nf1.format(d[0].avg_growth)}%</span>、1990年代は<span class="num">${nf1.format(d[3].avg_growth)}%</span>、2000年代は<span class="num">${nf1.format(d[4].avg_growth)}%</span>、2020年代は<span class="num">${nf1.format(d[6].avg_growth)}%</span>。`,
      `<strong>円建ての名目GDPは1995年の${fmtTrillionYen(jpy1995)}から${jpyLast.year}年の${fmtTrillionYen(jpyLast.value)}へ、30年で${fmtSignedPct(pctChange(jpy1995, jpyLast.value), 1)}。</strong>同期間の実質GDPは${fmtSignedPct(pctChange(real1995, realLast.value), 1)}で、名目と実質の伸びがほぼ同じ＝この間の物価上昇が小さかったことを意味する。`,
      `<strong>ドル建てでは${usdPeak.year}年の${nf2.format(usdPeak.value / 1e12)}兆ドルがピークで、${usdLast.year}年は${nf2.format(usdLast.value / 1e12)}兆ドル（${fmtSignedPct(pctChange(usdPeak.value, usdLast.value), 1)}）。</strong>円建ての水準は${jpyPeak.year}年に過去最高を更新しているため、この乖離は主に為替（${usdPeak.year}年は1ドル＝${at('fx_jpy_usd', usdPeak.year).toFixed(1)}円、${usdLast.year}年は${at('fx_jpy_usd', usdLast.year).toFixed(1)}円）によるものだ。`,
      `<strong>1人当たりGNIは${gniPeak.year}年の${fmtUsd(gniPeak.value)}がピーク。</strong>2024年は${fmtUsd(gni2024)}で<span class="num">${fmtSignedPct(pctChange(gniPeak.value, gni2024))}</span>。同じ2024年を購買力平価で測ると${fmtUsd(ppp2024)}になり、為替換算の<span class="num">${nf1.format(ppp2024 / gni2024)}倍</span>。円の対外購買力が国内の購買力より低いことを示す。`,
      `<strong>世界GDPに占めるシェアは${sharePeak.year}年の${nf1.format(sharePeak.value)}%がピークで、${shareLast.year}年は${nf1.format(shareLast.value)}%。</strong>${nf1.format(sharePeak.value - shareLast.value)}ポイントの低下。同じ期間に中国は${nf1.format(chnShare(1994))}%から${nf1.format(chnShare(shareLast.year))}%へ拡大しており、日本が失った分を別の国が埋めた構図が読み取れる。`,
      `<strong>1人当たりGNIの世界順位は1990年の${D.stats.rank_all_1990}位から${D.stats.rank_latest_year}年の${D.stats.rank_all_today}位へ。</strong>OECD加盟国内では${D.stats.rank_oecd_1990}位から${D.stats.rank_oecd_today}位へ低下。順位の低下は「日本が貧しくなった」というより、他の多くの国が日本より速く成長したことを映す。`,
      `<strong>1人当たりGDP（PPP）の対米比率は${YEARS[ratioFirstIdx]}年の${nf1.format(rFirst)}%から${YEARS[ratioLastIdx]}年の${nf1.format(rLast)}%へ。</strong>1990年代初頭には米国の8割台後半だった日本の水準は、6割台前半まで下がった。`,
      `<strong>人口は${popPeak.year}年の${NF.format(Math.round(popPeak.value / 1e4))}万人がピークで、${popLast.year}年は${NF.format(Math.round(popLast.value / 1e4))}万人。</strong>${NF.format(Math.round((popPeak.value - popLast.value) / 1e4))}万人の減少。1人当たり指標の分母は縮んでおり、総額の停滞ほどには1人当たりが悪化していない点には注意が必要だ。`,
      `<strong>所得の使い道は投資から消費へ。</strong>家計最終消費支出のGDP比は1970年の${nf1.format(cons70)}%から${consLast.year}年の${nf1.format(consLast.value)}%へ上昇し、総資本形成は${nf1.format(cap70)}%から${nf1.format(capLast.value)}%へ低下した。成長を支えた投資の比率がほぼ半減したことになる。`,
    ];

    document.getElementById('findings-list').innerHTML = rows.map((r) => `<li>${r}</li>`).join('');
  }

  /* ---------- ランキング表 ---------- */
  function renderRankTable() {
    const year = D.stats.rank_latest_year;
    const rows = D.rank.top[String(year)] || [];
    const names = {
      BMU: 'バミューダ', NOR: 'ノルウェー', CHE: 'スイス', LUX: 'ルクセンブルク', USA: 'アメリカ',
      CYM: 'ケイマン諸島', ISL: 'アイスランド', IRL: 'アイルランド', QAT: 'カタール', SGP: 'シンガポール',
      FRO: 'フェロー諸島', DNK: 'デンマーク', JPN: '日本', NLD: 'オランダ', SWE: 'スウェーデン',
      AUS: 'オーストラリア', AUT: 'オーストリア', DEU: 'ドイツ', CAN: 'カナダ', GBR: 'イギリス',
      FIN: 'フィンランド', BEL: 'ベルギー', ISR: 'イスラエル', ARE: 'アラブ首長国連邦', HKG: '香港',
      KOR: '韓国', FRA: 'フランス', ITA: 'イタリア', ESP: 'スペイン', TWN: '台湾',
    };
    const html = [
      `<caption class="visually-hidden">${year}年の1人当たりGNI上位国</caption>`,
      '<thead><tr><th>順位</th><th>国・地域</th><th>1人当たりGNI</th></tr></thead><tbody>',
      ...rows.map(
        (r) => `<tr class="${r.code === 'JPN' ? 'is-japan' : ''}">
          <td>${r.rank}</td><td>${names[r.code] || r.code}</td><td>${NF.format(Math.round(r.value))}ドル</td></tr>`
      ),
      '</tbody>',
    ].join('');
    document.getElementById('rank-table').innerHTML = html;
  }

  /* ---------- データ表 ---------- */
  const TABLE_COLUMNS = [
    { key: 'year', label: '年', get: (i) => YEARS[i] },
    { key: 'gdp_jpy', label: '名目GDP (兆円)', get: (i) => (S.gdp_jpy[i] === null ? null : S.gdp_jpy[i] / 1e12), digits: 1 },
    { key: 'gdp_usd', label: '名目GDP (兆ドル)', get: (i) => (S.gdp_usd[i] === null ? null : S.gdp_usd[i] / 1e12), digits: 2 },
    { key: 'real', label: '実質GDP指数 (1960=100)', get: (i) => (S.gdp_const_usd[i] === null ? null : S.gdp_const_usd[i] / seriesValues('gdp_const_usd')[0] * 100), digits: 1 },
    { key: 'growth', label: '実質成長率 (%)', get: (i) => S.growth_real[i], digits: 1 },
    { key: 'gni_pc', label: '1人当たりGNI ($)', get: (i) => S.gni_pc_usd[i], digits: 0 },
    { key: 'gni_ppp', label: '1人当たりGNI PPP ($)', get: (i) => S.gni_pc_ppp[i], digits: 0 },
    { key: 'share', label: '世界シェア (%)', get: (i) => D.world.japan_share_pct[i], digits: 1 },
    { key: 'pop', label: '人口 (万人)', get: (i) => (S.population[i] === null ? null : S.population[i] / 1e4), digits: 0 },
    { key: 'fx', label: '為替 (円/US$)', get: (i) => S.fx_jpy_usd[i], digits: 1 },
  ];

  function renderDataTable() {
    const head = '<thead><tr>' + TABLE_COLUMNS.map((c) => `<th scope="col">${c.label}</th>`).join('') + '</tr></thead>';
    const body = YEARS.map((y, i) => {
      const cells = TABLE_COLUMNS.map((c) => {
        if (c.key === 'year') return `<th scope="row">${y}</th>`;
        const v = c.get(i);
        if (v === null || v === undefined) return '<td>—</td>';
        return `<td>${c.digits === 0 ? NF.format(Math.round(v)) : v.toFixed(c.digits)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    document.getElementById('data-table').innerHTML = head + '<tbody>' + body + '</tbody>';
  }

  function downloadCsv() {
    const header = TABLE_COLUMNS.map((c) => c.label).join(',');
    const lines = YEARS.map((y, i) =>
      TABLE_COLUMNS.map((c) => {
        const v = c.get(i);
        if (v === null || v === undefined) return '';
        return c.key === 'year' ? String(v) : c.digits === 0 ? String(Math.round(v)) : v.toFixed(c.digits);
      }).join(',')
    );
    const csv = '\uFEFF' + [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'japan-national-income-1960-2025.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /* ---------- テキストの差し込み ---------- */
  function renderMeta() {
    const d = new Date(D.meta.retrieved_utc);
    const jp = (date) => `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
    document.getElementById('meta-updated').textContent = jp(d);
    const r = document.getElementById('meta-retrieved');
    if (r) r.textContent = jp(d);
    const a = document.getElementById('meta-api');
    if (a) a.textContent = D.meta.api_last_updated || '—';

    const multiple = lastOf('gdp_const_usd').value / seriesValues('gdp_const_usd').find((v) => v !== null);
    document.querySelectorAll('[data-stat="real-multiple"]').forEach((el) => (el.textContent = nf1.format(multiple)));

    const jpyLast = lastOf('gdp_jpy');
    document.querySelectorAll('[data-stat="jpy-peak"]').forEach((el) => (el.textContent = fmtTrillionYen(jpyLast.value)));

    const usdPeak = peakOf('gdp_usd');
    const usdLast = lastOf('gdp_usd');
    document.querySelectorAll('[data-stat="usd-vs-peak"]').forEach(
      (el) => (el.textContent = fmtSignedPct(pctChange(usdPeak.value, usdLast.value), 1))
    );

    document.querySelectorAll('[data-stat="share-peak"]').forEach((el) => (el.textContent = nf1.format(peakVal(SHARE).value)));
  }

  /* ---------- テーマ ---------- */
  const THEME_KEY = 'jni-theme';

  function setTheme(theme, persist) {
    root.setAttribute('data-theme', theme);
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    if (persist) {
      try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* 保存できない環境では無視 */ }
    }
    buildCharts();
  }

  function initTheme() {
    let stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (e) { /* noop */ }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', stored || (prefersDark ? 'dark' : 'light'));
    document.getElementById('theme-toggle').addEventListener('click', () => {
      setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true);
    });
  }

  /* ---------- まとめ ---------- */
  function buildCharts() {
    const t = palette();
    charts.forEach((c) => c.destroy());
    charts = [];
    chartReal(t);
    chartDecades(t);
    chartNominal(t);
    chartPerCapita(t);
    chartVsUS(t);
    chartShare(t);
    chartRank(t);
    chartStructure(t);
  }

  function init() {
    initTheme();
    renderMeta();
    renderKpis();
    renderFindings();
    renderRankTable();
    renderDataTable();
    buildCharts();
    document.getElementById('download-csv').addEventListener('click', downloadCsv);

    // テーマ切替後に再描画されるため、canvas の aria-label は維持される
    window.addEventListener('resize', () => { /* Chart.js が自動処理 */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
