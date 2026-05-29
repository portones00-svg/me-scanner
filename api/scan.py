from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json, datetime

SECTORS = {
    "sp500": ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","V","UNH","XOM","LLY","JNJ","WMT","MA","PG","HD","MRK","AVGO","CVX","PEP","COST","ABBV","KO","ADBE","CRM","BAC","MCD","CSCO","PFE","ABT","NKE","ORCL","TXN","NEE","HON","IBM","AMGN","GE","QCOM","LOW","INTU","CAT","SPGI","BLK","ISRG","AXP","GS","MS","BKNG","SYK","TJX","ADP","VRTX","ADI","REGN","MMC","ZTS","CI","SO","MO","EOG","SLB","NOC","ITW","CME","CL","USB","PNC","TGT","EMR","MCO","F","GM","CTAS","WM","APD","NSC","HCA","ECL","DUK","WFC","C","DVN","MPC","VLO","OXY","NEM","SHW","PPG","NUE","BA","CMG","COP","DE","DIS","EW","EXC","HAL","HES","HIG","HLT","ICE","IDXX","LIN","LMT","MAR","MET","MOS","NTRS","O","PAYX","PRU","RF","RMD","ROK","ROST","SBUX","SPG","STZ","SWK","SYF","T","TDG","TEL","TFC","TMUS","TROW","TRV","TSCO","UAL","UPS","VZ","WAT","WBA","WEC","WELL","WMB","XEL","YUM","ZTS"],
    "nasdaq": ["NFLX","PYPL","INTC","AMD","AMAT","KLAC","LRCX","MRVL","PANW","SNPS","CDNS","FTNT","TEAM","ZS","DDOG","CRWD","OKTA","MDB","NET","SNOW","ABNB","DASH","COIN","RBLX","SOFI","AFRM","UPST","MELI","UBER","LYFT","EXPE","DKNG","CMCSA","SNAP","PINS","SPOT","BIDU","JD","PDD","NIO","XPEV","LI","RIVN","LCID","IONQ","RKLB","ACHR","JOBY","BILI","NTES","WDAY","VEEV","HUBS","DXCM","ALGN","IDXX","LULU","NXPI","SMCI","HOOD","PLTR","TTD","TWLO","BILL","MNDY","TOST","PATH"],
    "semis": ["NVDA","AMD","INTC","QCOM","AVGO","TXN","AMAT","KLAC","LRCX","MRVL","ON","SWKS","QRVO","MPWR","WOLF","ACLS","COHU","FORM","ICHR","MKSI","AMBA","SLAB","DIOD","SITM","MTSI","AEHR","AOSL","POWI","LSCC","RMBS","HIMX","ONTO","FSLR","ENPH","SEDG","SPWR","RUN","CSIQ","BRKS","CAMT","ENTG","IPGP","KLIC"],
    "pharma": ["PFE","MRK","ABBV","LLY","BMY","AMGN","GILD","BIIB","REGN","VRTX","MRNA","BNTX","INCY","BMRN","ALNY","IONS","SRPT","ARWR","NTLA","BEAM","EDIT","CRSP","SGEN","EXEL","JAZZ","ITCI","ACAD","HALO","RARE","FOLD","ARCT","APLS","TGTX","AGIO","KYMR","IMVT","NKTR","RCKT","AVXL","FATE","BLUE","VCEL","ZLAB","NBIX","INSM","SAGE","RXRX"],
    "small": ["SMCI","IONQ","RKLB","ACHR","JOBY","LUNR","ASTS","SPCE","NKLA","WKHS","FFIE","MULN","MMAT","SNDL","TLRY","CGC","ACB","HEXO","CRON","GRWG","IIPR","VALE","CLOV","AMC","GME","BB","NOK","BNGO","MVIS","CLSK","RIOT","MARA","BTBT","HUT","CIFR","IREN","WULF","MIGI","BITF","LCID","RIVN"],
    "etfs": ["XLK","XLF","XLV","XLE","XLI","XLY","XLP","XLB","XLU","XLRE","QQQ","SPY","IWM","DIA","VTI","VGT","ARKK","ARKG","ARKW","SOXL","SOXS","TQQQ","GDX","GDXJ","GLD","SLV","TAN","ICLN","DRIV","MSOS"]
}

SECTOR_LABELS = {
    "sp500":"S&P 500","nasdaq":"Nasdaq 100","semis":"Semiconductores",
    "pharma":"Farmacéuticas","small":"Small/Mid Cap","etfs":"ETFs"
}

def calc_ema(prices, period):
    if len(prices) < period: return None
    k = 2 / (period + 1)
    ema = sum(prices[:period]) / period
    for p in prices[period:]: ema = p * k + ema * (1 - k)
    return ema

def calc_rsi(prices, period=14):
    if len(prices) < period + 1: return None
    changes = [prices[i] - prices[i-1] for i in range(1, len(prices))]
    recent = changes[-period:]
    gains = sum(c for c in recent if c > 0) / period
    losses = abs(sum(c for c in recent if c < 0)) / period
    if losses == 0: return 100.0
    return round(100 - 100 / (1 + gains/losses), 1)

def fetch_ticker(ticker, sector_label):
    try:
        import yfinance as yf
        tk = yf.Ticker(ticker)
        hist = tk.history(period="3mo", interval="1d", auto_adjust=True)
        if hist.empty or len(hist) < 22: return None
        cl = hist["Close"].dropna().tolist()
        vo = hist["Volume"].dropna().tolist()
        if len(cl) < 22: return None
        cur = cl[-1]; prv = cl[-2]
        p5 = cl[-6] if len(cl) >= 6 else None
        e10 = calc_ema(cl, 10); e20 = calc_ema(cl, 20); rsi = calc_rsi(cl)
        if not e10 or not e20: return None
        d10 = round((cur - e10) / e10 * 100, 2)
        d20 = round((cur - e20) / e20 * 100, 2)
        if d10 >= 0: return None
        avgv = sum(vo[-21:-1]) / 20 if len(vo) >= 21 else sum(vo) / len(vo)
        rv = round(vo[-1] / avgv, 2) if avgv > 0 else 1.0
        c1 = round((cur - prv) / prv * 100, 2)
        c5 = round((cur - p5) / p5 * 100, 2) if p5 else None
        sc = round(abs(d10) * 0.5 + rv * 8 + max(0, 50 - (rsi or 50)) * 0.4, 1)
        try: nm = getattr(tk.fast_info, "long_name", None) or ticker
        except: nm = ticker
        return {
            "ticker": ticker, "name": nm, "sector": sector_label,
            "price": round(cur, 2), "ema10": round(e10, 2), "ema20": round(e20, 2),
            "dist10": d10, "dist20": d20, "rsi": rsi, "rel_vol": rv,
            "change1d": c1, "change5d": c5, "score": sc,
            "marketcap": "micro" if cur < 5 else "large",
            "ai_analysis": None, "razon_baja": "toma_ganancias"
        }
    except: return None

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        sector_key = params.get("sector", ["sp500"])[0]
        min_dist = float(params.get("min_dist", ["2"])[0])
        tickers = SECTORS.get(sector_key, SECTORS["sp500"])
        sector_label = SECTOR_LABELS.get(sector_key, "S&P 500")
        results = []
        for ticker in tickers:
            r = fetch_ticker(ticker, sector_label)
            if r and abs(r["dist10"]) >= min_dist:
                results.append(r)
        results.sort(key=lambda x: x["score"], reverse=True)
        response = {
            "ok": True, "sector": sector_label,
            "total_scanned": len(tickers), "found": len(results),
            "timestamp": datetime.datetime.now().isoformat(),
            "data": results[:30]
        }
        self.wfile.write(json.dumps(response, ensure_ascii=False).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    def log_message(self, *args): pass
