module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  const tickerSearch = req.query.ticker;
  if(tickerSearch){
    const t = tickerSearch.toUpperCase();
    const result = await fetchTicker(t, true);
    if(!result) return res.json({ok:true,found:0,data:[]});
    if(ANTHROPIC_API_KEY) result.ai_analysis = await aiAnalyze(result);
    return res.json({ok:true,found:1,data:[result]});
  }
  const sector = req.query.sector || 'sp500';
  const minDist = parseFloat(req.query.min_dist || '2');
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const NEWS_API_KEY = process.env.NEWS_API_KEY;
  const SECTORS = {
    sp500: ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","V","UNH","XOM","LLY","JNJ","WMT","MA","PG","HD","MRK","AVGO","CVX","PEP","COST","ABBV","KO","ADBE","CRM","BAC","MCD","CSCO","PFE","ABT","NKE","ORCL","TXN","NEE","HON","IBM","AMGN","GE","QCOM","LOW","INTU","CAT","GS","MS","AXP","SYK","TJX","ADP","VRTX","ADI","REGN","ZTS","CI","SO","MO","EOG","SLB","NOC","ITW","CME","CL","USB","PNC","TGT","EMR","MCO","F","GM","WM","APD","NSC","HCA","ECL","DUK","WFC","C","DVN","MPC","VLO","OXY","NEM","SHW","PPG","NUE"],
    nasdaq: ["NFLX","PYPL","INTC","AMD","AMAT","KLAC","LRCX","MRVL","PANW","SNPS","CDNS","FTNT","TEAM","ZS","DDOG","CRWD","OKTA","MDB","NET","SNOW","ABNB","DASH","COIN","MELI","UBER","LYFT","SNAP","SPOT","BIDU","NIO","XPEV","RIVN","IONQ","RKLB","JOBY","WDAY","VEEV","HUBS","DXCM","LULU","SMCI","HOOD","PLTR","TTD","BILL","MNDY"],
    semis: ["NVDA","AMD","INTC","QCOM","AVGO","TXN","AMAT","KLAC","LRCX","MRVL","ON","SWKS","MPWR","WOLF","ACLS","FORM","AMBA","SLAB","DIOD","SITM","AEHR","POWI","LSCC","ONTO","FSLR","ENPH","SEDG","SPWR","BRKS","CAMT","ENTG","KLIC"],
    pharma: ["PFE","MRK","ABBV","LLY","BMY","AMGN","GILD","BIIB","REGN","VRTX","MRNA","BNTX","INCY","BMRN","ALNY","IONS","SRPT","ARWR","BEAM","CRSP","EXEL","JAZZ","ITCI","ACAD","HALO","ARCT","APLS","TGTX","AGIO","IMVT","RCKT","NBIX","INSM","SAGE","RXRX"],
    small: ["SMCI","IONQ","RKLB","ACHR","JOBY","LUNR","ASTS","SPCE","NKLA","MULN","SNDL","TLRY","CGC","ACB","CRON","VALE","CLOV","AMC","GME","BB","NOK","BNGO","MVIS","CLSK","RIOT","MARA","BTBT","HUT","IREN","MIGI","BITF","LCID","RIVN"],
    etfs: ["XLK","XLF","XLV","XLE","XLI","XLY","XLP","XLB","XLU","XLRE","QQQ","SPY","IWM","DIA","VTI","VGT","ARKK","ARKG","SOXL","TQQQ","GDX","GDXJ","GLD","SLV","TAN","ICLN"],
    energy: ["XOM","CVX","COP","EOG","SLB","MPC","VLO","PSX","OXY","DVN","HAL","BKR","FANG","APA","MRO","HES","WMB","OKE","KMI","ET","EPD","TRGP","MPC","PXD"],
    financials: ["JPM","BAC","WFC","GS","MS","C","BLK","SCHW","AXP","USB","PNC","TFC","COF","MCO","SPGI","CME","ICE","CB","AIG","MET","PRU","AFL","ALL","PGR","TRV"],
    consumer: ["AMZN","TSLA","HD","MCD","NKE","SBUX","TGT","LOW","TJX","COST","WMT","DG","DLTR","ROST","BBY","ETSY","DKNG","MGM","LVS","MAR","HLT","YUM","CMG"],
    healthcare: ["UNH","JNJ","LLY","ABT","MRK","TMO","DHR","SYK","ISRG","EW","BSX","BDX","ZBH","RMD","ALGN","HCA","CNC","MOH","HUM","CI"],
    realestate: ["AMT","PLD","EQIX","CCI","PSA","EQR","AVB","VTR","WELL","O","SPG","ARE","BXP","KIM","REG","FRT","UDR","CPT","ESS","NNN"]
  };
  const LABELS = {sp500:"S&P 500",nasdaq:"Nasdaq 100",semis:"Semiconductores",pharma:"Farmacéuticas",small:"Small/Mid Cap",etfs:"ETFs",energy:"Energía",financials:"Financieras",consumer:"Consumo",healthcare:"Healthcare",realestate:"Real Estate"};
  const allTickers = [...new Set(Object.values(SECTORS).flat())];
  const tickers = sector === 'fullscan' ? allTickers : (SECTORS[sector] || SECTORS.sp500);
  const label = LABELS[sector] || "S&P 500";
  function calcEMA(prices, period) {
    if (prices.length < period) return null;
    const k = 2/(period+1);
    let ema = prices.slice(0,period).reduce((a,b)=>a+b,0)/period;
    for (let i=period; i<prices.length; i++) ema = prices[i]*k + ema*(1-k);
    return ema;
  }
  function calcRSI(prices, period=14) {
    if (prices.length < period+1) return null;
    const changes = prices.slice(1).map((p,i)=>p-prices[i]);
    const recent = changes.slice(-period);
    const gains = recent.filter(c=>c>0).reduce((a,b)=>a+b,0)/period;
    const losses = Math.abs(recent.filter(c=>c<0).reduce((a,b)=>a+b,0))/period;
    if (losses===0) return 100;
    return Math.round((100-100/(1+gains/losses))*10)/10;
  }
  async function fetchTicker(ticker, force=false) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=3mo`,{headers:{'User-Agent':'Mozilla/5.0'}});
      if (!r.ok) return null;
      const data = await r.json();
      const result = data?.chart?.result?.[0];
      if (!result) return null;
      const closes = result.indicators?.quote?.[0]?.close?.filter(Boolean)||[];
      const volumes = result.indicators?.quote?.[0]?.volume?.filter(Boolean)||[];
      if (closes.length<22) return null;
      const cur=closes[closes.length-1], prv=closes[closes.length-2];
      const p5=closes.length>=6?closes[closes.length-6]:null;
      const e10=calcEMA(closes,10), e20=calcEMA(closes,20), rsi=calcRSI(closes);
      if (!e10||!e20) return null;
      const d10=Math.round((cur-e10)/e10*10000)/100;
      const d20=Math.round((cur-e20)/e20*10000)/100;
      if (d10>=0 && !force) return null;
      const avgVol=volumes.slice(-21,-1).reduce((a,b)=>a+b,0)/20;
      const rv=Math.round(volumes[volumes.length-1]/avgVol*100)/100;
      const c1=Math.round((cur-prv)/prv*10000)/100;
      const c5=p5?Math.round((cur-p5)/p5*10000)/100:null;
      const absDist=Math.abs(d10);
      const priceBonus=cur>=100?20:cur>=50?5:-10;
      const earningsPenalty=c1<-8?-30:c1<-5?-15:0;
      const gradualDrop=(c5&&c5<-3&&c5>-15&&c1>-5)?15:0;
      const volBonus=rv<0.8?10:rv<1.2?5:0;
      const PREMIUM=['AAPL','MSFT','NVDA','GOOGL','META','AMZN','TSLA','JPM','GS','MS','COST','WMT','HD','AVGO','AMD','AMAT','KLAC','LRCX','V','MA','UNH','LLY','ABBV','CRM','ADBE','INTU','NFLX','COIN','MELI','CRWD'];
      const premiumBonus = PREMIUM.includes(ticker) ? 15 : 0;
      const score=Math.round(absDist*0.6+priceBonus+earningsPenalty+gradualDrop+volBonus+Math.max(0,50-(rsi||50))*0.3+premiumBonus);
      const razon_baja=c1<-6||(c5&&c5<-15)?'malos_earnings':'toma_ganancias';
      const marketcap=cur<5?'micro':cur<20?'small':'large';
      return {ticker,name:result.meta?.shortName||ticker,sector:label,price:Math.round(cur*100)/100,ema10:Math.round(e10*100)/100,ema20:Math.round(e20*100)/100,dist10:d10,dist20:d20,rsi,rel_vol:rv,change1d:c1,change5d:c5,score,marketcap,razon_baja,ai_analysis:null};
    } catch { return null; }
  }
  async function fetchNews(ticker, companyName) {
    if (!NEWS_API_KEY) return 'Sin noticias disponibles.';
    try {
      const query = encodeURIComponent(`${ticker} OR "${companyName}"`);
      const url = `https://newsapi.org/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=5&apiKey=${NEWS_API_KEY}`;
      const r = await fetch(url);
      const data = await r.json();
      if (!data.articles || data.articles.length === 0) return 'Sin noticias recientes encontradas.';
      return data.articles.slice(0,5).map(a =>
        `- ${a.title} (${new Date(a.publishedAt).toLocaleDateString('es')})`
      ).join('\n');
    } catch { return 'No se pudieron obtener noticias.'; }
  }
  async function aiAnalyze(stock) {
    if (!ANTHROPIC_API_KEY) return null;
    try {
      const news = await fetchNews(stock.ticker, stock.name);
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
        body: JSON.stringify({
          model:'claude-haiku-4-5-20251001',
          max_tokens:600,
          messages:[{role:'user',content:`Eres un asesor de trading amigable. Analiza esta acción para un trader usando el método de Oliver Kell (regresión a la media EMA 10/20).

Acción: ${stock.ticker} - ${stock.name}
Precio actual: $${stock.price}
Está ${Math.abs(stock.dist10)}% por debajo de su promedio de 10 días
RSI: ${stock.rsi} ${stock.rsi<30?'(muy sobrevendida)':''}
Volumen: ${stock.rel_vol}x el promedio
Caída hoy: ${stock.change1d}% | Caída 5 días: ${stock.change5d}%

NOTICIAS RECIENTES DE LA WEB:
${news}

Escribe un análisis simple en español, sin símbolos # ni ---. Formato exacto:

VEREDICTO: [ENTRAR ✅ / CUIDADO ⚠️ / EVITAR ❌]

POR QUÉ BAJÓ:
Explica en 2 oraciones basándote en las noticias reales. Si hay earnings negativos, menciónalo.

¿VAN A VOLVER LOS GRANDES INVERSORES?
1-2 oraciones. ¿La caída es técnica o fundamental?

CÓMO ENTRAR:
Precio sugerido y señal a esperar.

STOP LOSS: $${Math.round(stock.price*0.95*100)/100} | OBJETIVO 1: $${stock.ema10} | OBJETIVO 2: $${stock.ema20}

RESUMEN:
Una frase que resuma si vale la pena o no.`}]
        })
      });
      const d = await r.json();
      return d.content?.[0]?.text || null;
    } catch { return null; }
  }
  const results=[];
  for (let i=0; i<tickers.length; i+=5) {
    const batch=tickers.slice(i,i+5);
    const br=await Promise.all(batch.map(t=>fetchTicker(t)));
    br.forEach(r=>{if(r&&Math.abs(r.dist10)>=minDist)results.push(r);});
  }
  results.sort((a,b)=>b.score-a.score);
  const top = results.slice(0,40);
  if (ANTHROPIC_API_KEY) {
    for (let i=0; i<Math.min(15,top.length); i++) {
      top[i].ai_analysis = await aiAnalyze(top[i]);
    }
  }
  res.json({ok:true,sector:label,total_scanned:tickers.length,found:results.length,timestamp:new Date().toISOString(),data:top});
};
