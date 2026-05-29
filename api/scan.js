module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  const sector = req.query.sector || 'sp500';
  const minDist = parseFloat(req.query.min_dist || '2');
  const SECTORS = {
    sp500: ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","V","UNH","XOM","LLY","JNJ","WMT","MA","PG","HD","MRK","AVGO","CVX","PEP","COST","ABBV","KO","ADBE","CRM","BAC","MCD","CSCO","PFE","ABT","NKE","ORCL","TXN","NEE","HON","IBM","AMGN","GE","QCOM","LOW","INTU","CAT","GS","MS","AXP","SYK","TJX","ADP","VRTX","ADI","REGN","ZTS","CI","SO","MO","EOG","SLB","NOC","ITW","CME","CL","USB","PNC","TGT","EMR","MCO","F","GM","WM","APD","NSC","HCA","ECL","DUK","WFC","C","DVN","MPC","VLO","OXY","NEM","SHW","PPG","NUE"],
    nasdaq: ["NFLX","PYPL","INTC","AMD","AMAT","KLAC","LRCX","MRVL","PANW","SNPS","CDNS","FTNT","TEAM","ZS","DDOG","CRWD","OKTA","MDB","NET","SNOW","ABNB","DASH","COIN","MELI","UBER","LYFT","SNAP","SPOT","BIDU","NIO","XPEV","RIVN","IONQ","RKLB","JOBY","WDAY","VEEV","HUBS","DXCM","LULU","SMCI","HOOD","PLTR","TTD","BILL","MNDY"],
    semis: ["NVDA","AMD","INTC","QCOM","AVGO","TXN","AMAT","KLAC","LRCX","MRVL","ON","SWKS","MPWR","WOLF","ACLS","FORM","AMBA","SLAB","DIOD","SITM","AEHR","POWI","LSCC","ONTO","FSLR","ENPH","SEDG","SPWR","BRKS","CAMT","ENTG","KLIC"],
    pharma: ["PFE","MRK","ABBV","LLY","BMY","AMGN","GILD","BIIB","REGN","VRTX","MRNA","BNTX","INCY","BMRN","ALNY","IONS","SRPT","ARWR","BEAM","CRSP","EXEL","JAZZ","ITCI","ACAD","HALO","ARCT","APLS","TGTX","AGIO","IMVT","RCKT","NBIX","INSM","SAGE","RXRX"],
    small: ["SMCI","IONQ","RKLB","ACHR","JOBY","LUNR","ASTS","SPCE","NKLA","MULN","SNDL","TLRY","CGC","ACB","CRON","VALE","CLOV","AMC","GME","BB","NOK","BNGO","MVIS","CLSK","RIOT","MARA","BTBT","HUT","IREN","MIGI","BITF","LCID","RIVN"],
    etfs: ["XLK","XLF","XLV","XLE","XLI","XLY","XLP","XLB","XLU","XLRE","QQQ","SPY","IWM","DIA","VTI","VGT","ARKK","ARKG","SOXL","TQQQ","GDX","GDXJ","GLD","SLV","TAN","ICLN"]
  };
  const LABELS = {sp500:"S&P 500",nasdaq:"Nasdaq 100",semis:"Semiconductores",pharma:"Farmacéuticas",small:"Small/Mid Cap",etfs:"ETFs"};
  const tickers = SECTORS[sector] || SECTORS.sp500;
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
  async function fetchTicker(ticker) {
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
      if (d10>=0) return null;
      const avgVol=volumes.slice(-21,-1).reduce((a,b)=>a+b,0)/20;
      const rv=Math.round(volumes[volumes.length-1]/avgVol*100)/100;
      const c1=Math.round((cur-prv)/prv*10000)/100;
      const c5=p5?Math.round((cur-p5)/p5*10000)/100:null;
      const absDist=Math.abs(d10);
      const priceBonus=cur>=100?20:cur>=50?5:-10;
      const earningsPenalty=c1<-8?-30:c1<-5?-15:0;
      const gradualDrop=(c5&&c5<-3&&c5>-15&&c1>-5)?15:0;
      const volBonus=rv<0.8?10:rv<1.2?5:0;
      const score=Math.round(absDist*0.6+priceBonus+earningsPenalty+gradualDrop+volBonus+Math.max(0,50-(rsi||50))*0.3);
      const razon_baja=c1<-6||(c5&&c5<-15)?'malos_earnings':'toma_ganancias';
      const marketcap=cur<5?'micro':cur<20?'small':'large';
      return {ticker,name:result.meta?.shortName||ticker,sector:label,price:Math.round(cur*100)/100,ema10:Math.round(e10*100)/100,ema20:Math.round(e20*100)/100,dist10:d10,dist20:d20,rsi,rel_vol:rv,change1d:c1,change5d:c5,score,marketcap,razon_baja,ai_analysis:null};
    } catch { return null; }
  }
  const results=[];
  for (let i=0; i<tickers.length; i+=5) {
    const batch=tickers.slice(i,i+5);
    const br=await Promise.all(batch.map(t=>fetchTicker(t)));
    br.forEach(r=>{if(r&&Math.abs(r.dist10)>=minDist)results.push(r);});
  }
  results.sort((a,b)=>b.score-a.score);
  res.json({ok:true,sector:label,total_scanned:tickers.length,found:results.length,timestamp:new Date().toISOString(),data:results.slice(0,40)});
};
