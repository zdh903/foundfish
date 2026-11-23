// 验证批量指数接口：与 services.ts 中 zindexFromUlist 相同的 URL/字段映射
const EM_PUSH2 = 'https://61.push2.eastmoney.com';
const codes = ['1.000001', '0.399001', '1.000688', '1.000300', '0.399006', '100.DJIA', '100.SPX', '100.NDX'];

function timeFromTimestamp(ts) {
  const d = new Date(ts * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function num(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
function fields(d) {
  return {
    name: d.f14 || '', zindexCode: d.f12 || '', type: num(d.f13),
    zsz: num(d.f2), zdd: num(d.f4), zdf: num(d.f3),
    zg: num(d.f15), zd: num(d.f16), jk: num(d.f17), zs: num(d.f18),
    time: d.f124 ? timeFromTimestamp(Number(d.f124)) : '',
  };
}

const t0 = Date.now();
const url = `${EM_PUSH2}/api/qt/ulist.np/get?fltt=2&fields=f2,f3,f4,f12,f13,f14,f15,f16,f17,f18,f124&secids=${codes.join(',')}`;
const res = await fetch(url, { headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' } });
const data = await res.json();
const elapsed = Date.now() - t0;

const byCode = new Map();
for (const d of data?.data?.diff || []) {
  byCode.set(`${d.f13}.${d.f12}`, d);
}
const rows = codes.map((code) => {
  const d = byCode.get(code);
  return d ? { code, ...fields(d) } : { code, MISSING: true };
});
console.log(`耗时 ${elapsed}ms, 返回 ${rows.filter(r => !r.MISSING).length}/${codes.length}`);
for (const r of rows) {
  if (r.MISSING) console.log(`  ${code} 缺失`);
  else console.log(`  ${r.name}(${r.zindexCode}) ${r.zsz} ${r.zdd >= 0 ? '+' : ''}${r.zdd} ${r.zdf >= 0 ? '+' : ''}${r.zdf}% @${r.time}`);
}
