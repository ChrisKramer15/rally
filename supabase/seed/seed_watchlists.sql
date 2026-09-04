-- ---------------------------------------------------------------------------
-- seed_watchlists.sql
--
-- Populates 10 named watchlists (slots 1..10), 40 tickers each = 400 symbols,
-- curated for the supply/demand strategy: liquid, optionable names that tend to
-- produce explosive, large-body (marubozu) moves out of tight bases — i.e. the
-- behaviour the ATR-normalized zone/explosive detector scores highest. Avoids
-- sleepy low-beta names (which rarely clear 2x ATR with a >=0.60 body) and
-- illiquid microcaps (whose noisy wicks create false zones).
--
-- A symbol belongs to exactly ONE list. `watchlist.symbol` is the PK, so the
-- upsert below sets each symbol's owning list; re-running is idempotent and
-- moves a symbol if it's reassigned.
--
-- Run against the linked project:
--   supabase db query --linked -f supabase/seed/seed_watchlists.sql
-- ---------------------------------------------------------------------------

begin;

-- 1) Ensure all 10 lists exist with meaningful names, keyed by slot.
--    Slot 1 already exists as "Main" (created by migration 0008); rename it.
update public.watchlists set name = 'Mega-Cap Tech & Momentum' where slot = 1;

insert into public.watchlists (name, slot) values
  ('Semiconductors',            2),
  ('Software & Cloud',          3),
  ('AI, Data & Cyber',          4),
  ('Growth & Momentum',         5),
  ('Consumer & Retail',         6),
  ('Financials & Fintech',      7),
  ('Energy & Materials',        8),
  ('Biotech & Healthcare',      9),
  ('ETFs & Thematics',          10)
on conflict (slot) do update set name = excluded.name;

-- 2) Assign symbols to lists. One temp table drives a single upsert so a symbol
--    lands in exactly one list (last assignment wins if duplicated).
create temporary table _seed(symbol text primary key, slot int) on commit drop;

insert into _seed(symbol, slot) values
-- ── Slot 1: Mega-Cap Tech & Momentum (liquid leaders, clean impulse candles) ──
('AAPL',1),('MSFT',1),('NVDA',1),('AMZN',1),('GOOGL',1),('META',1),('TSLA',1),('AVGO',1),
('NFLX',1),('AMD',1),('ORCL',1),('CRM',1),('ADBE',1),('COST',1),('PEP',1),('CSCO',1),
('QCOM',1),('TXN',1),('INTC',1),('IBM',1),('NOW',1),('INTU',1),('AMAT',1),('MU',1),
('LRCX',1),('ADI',1),('PANW',1),('SNPS',1),('CDNS',1),('KLAC',1),('MRVL',1),('FTNT',1),
('ADSK',1),('WDAY',1),('TEAM',1),('DDOG',1),('SNOW',1),('NET',1),('CRWD',1),('ZS',1),

-- ── Slot 2: Semiconductors (high-beta, big ATR moves on cycles/news) ──
('ON',2),('NXPI',2),('MCHP',2),('SWKS',2),('QRVO',2),('MPWR',2),('ENPH',2),('SEDG',2),
('FSLR',2),('WOLF',2),('AMKR',2),('TER',2),('ENTG',2),('OLED',2),('SITM',2),('LSCC',2),
('POWI',2),('DIOD',2),('RMBS',2),('ALGM',2),('AOSL',2),('SMTC',2),('CRUS',2),('SLAB',2),
('ARM',2),('SMCI',2),('ASML',2),('TSM',2),('UMC',2),('STM',2),('GFS',2),('INDI',2),
('NVTS',2),('AEHR',2),('COHR',2),('LITE',2),('VSH',2),('FORM',2),('ACLS',2),('ICHR',2),

-- ── Slot 3: Software & Cloud (momentum SaaS; impulsive on earnings) ──
('SHOP',3),('UBER',3),('ABNB',3),('DOCU',3),('OKTA',3),('MDB',3),('HUBS',3),('TWLO',3),
('ZM',3),('BILL',3),('PATH',3),('GTLB',3),('S',3),('ESTC',3),('CFLT',3),('FROG',3),
('APPF',3),('PCTY',3),('PAYC',3),('BSY',3),('MANH',3),('DBX',3),('BOX',3),('SMAR',3),
('ASAN',3),('MNDY',3),('FRSH',3),('BRZE',3),('AI',3),('APP',3),('U',3),('RBLX',3),
('DUOL',3),('TTD',3),('RNG',3),('PEGA',3),('NICE',3),('TYL',3),('GWRE',3),('OTEX',3),

-- ── Slot 4: AI, Data & Cyber (thematic leaders with explosive tendencies) ──
('PLTR',4),('GEV',4),('DELL',4),('ANET',4),('VRT',4),('CIEN',4),('PSTG',4),('NTAP',4),
('STX',4),('WDC',4),('HPE',4),('JNPR',4),('AKAM',4),('FFIV',4),('CHKP',4),('CYBR',4),
('QLYS',4),('RPD',4),('TENB',4),('VRNS',4),('SAIL',4),('OSPN',4),('MSTR',4),('COIN',4),
('HOOD',4),('SOFI',4),('AFRM',4),('UPST',4),('LC',4),('DAVE',4),('MARA',4),('RIOT',4),
('CLSK',4),('BTBT',4),('HUT',4),('WULF',4),('CIFR',4),('BITF',4),('IREN',4),('CORZ',4),

-- ── Slot 5: Growth & Momentum (high-ADR movers, EV/space/consumer growth) ──
('RIVN',5),('LCID',5),('NIO',5),('XPEV',5),('LI',5),('CHPT',5),('QS',5),('PLUG',5),
('BLNK',5),('FCEL',5),('RUN',5),('NKLA',5),('ACHR',5),('JOBY',5),('RKLB',5),('ASTS',5),
('LUNR',5),('RCAT',5),('SPCE',5),('DNA',5),('IONQ',5),('QBTS',5),('RGTI',5),('SOUN',5),
('BBAI',5),('LAZR',5),('INVZ',5),('OUST',5),('CELH',5),('DKNG',5),('CVNA',5),('CART',5),
('W',5),('CHWY',5),('ROKU',5),('PINS',5),('SNAP',5),('DASH',5),('TOST',5),('GRAB',5),

-- ── Slot 6: Consumer & Retail (liquid names with earnings-driven gaps) ──
('WMT',6),('HD',6),('LOW',6),('TGT',6),('NKE',6),('SBUX',6),('MCD',6),('CMG',6),
('LULU',6),('DECK',6),('ROST',6),('TJX',6),('DG',6),('DLTR',6),('ULTA',6),('BURL',6),
('KMX',6),('RH',6),('WSM',6),('BBWI',6),('YETI',6),('CROX',6),('ONON',6),('BIRK',6),
('EL',6),('CL',6),('KO',6),('PG',6),('MDLZ',6),('KHC',6),('MNST',6),('KDP',6),
('DPZ',6),('YUM',6),('QSR',6),('WING',6),('CAVA',6),('SG',6),('DRI',6),('TXRH',6),

-- ── Slot 7: Financials & Fintech (banks, brokers, payments) ──
('JPM',7),('BAC',7),('WFC',7),('GS',7),('MS',7),('C',7),('SCHW',7),('AXP',7),
('V',7),('MA',7),('PYPL',7),('XYZ',7),('FIS',7),('FI',7),('GPN',7),('BK',7),
('USB',7),('PNC',7),('TFC',7),('COF',7),('DFS',7),('ALLY',7),('SYF',7),('KEY',7),
('CFG',7),('RF',7),('HBAN',7),('FITB',7),('BLK',7),('SPGI',7),('MCO',7),('ICE',7),
('CME',7),('NDAQ',7),('CBOE',7),('MKTX',7),('TROW',7),('STT',7),('NTRS',7),('RJF',7),

-- ── Slot 8: Energy & Materials (commodity-driven, big trending moves) ──
('XOM',8),('CVX',8),('COP',8),('SLB',8),('EOG',8),('OXY',8),('PSX',8),('MPC',8),
('VLO',8),('HAL',8),('DVN',8),('FANG',8),('HES',8),('CTRA',8),('APA',8),('TRGP',8),
('KMI',8),('WMB',8),('OKE',8),('LNG',8),('FCX',8),('NEM',8),('GOLD',8),('AA',8),
('CLF',8),('X',8),('NUE',8),('STLD',8),('MP',8),('ALB',8),('SQM',8),('CF',8),
('MOS',8),('DOW',8),('LYB',8),('CCJ',8),('UEC',8),('UUUU',8),('DNN',8),('SMR',8),

-- ── Slot 9: Biotech & Healthcare (catalyst-driven; explosive on data/FDA) ──
('LLY',9),('NVO',9),('MRK',9),('PFE',9),('ABBV',9),('AMGN',9),('GILD',9),('BMY',9),
('VRTX',9),('REGN',9),('BIIB',9),('MRNA',9),('BNTX',9),('ILMN',9),('ISRG',9),('DXCM',9),
('MDT',9),('BSX',9),('SYK',9),('EW',9),('ALNY',9),('SRPT',9),('EXEL',9),('NBIX',9),
('IONS',9),('HALO',9),('RARE',9),('CRSP',9),('NTLA',9),('BEAM',9),('VKTX',9),('HIMS',9),
('TDOC',9),('DVA',9),('CI',9),('UNH',9),('CVS',9),('HUM',9),('MCK',9),('ELV',9),

-- ── Slot 10: ETFs & Thematics (liquid ETFs; clean HTF zones per the strategy) ──
('SPY',10),('QQQ',10),('IWM',10),('DIA',10),('SMH',10),('SOXX',10),('XLK',10),('XLF',10),
('XLE',10),('XLV',10),('XLI',10),('XLY',10),('XLP',10),('XLU',10),('XLB',10),('XLC',10),
('XBI',10),('IBB',10),('ARKK',10),('ARKG',10),('TAN',10),('ICLN',10),('LIT',10),('URA',10),
('GDX',10),('GDXJ',10),('XOP',10),('OIH',10),('KRE',10),('KWEB',10),('FXI',10),('EEM',10),
('TLT',10),('HYG',10),('GLD',10),('SLV',10),('USO',10),('UNG',10),('BITO',10),('IGV',10)
on conflict (symbol) do update set slot = excluded.slot;

-- 3) Upsert every seed symbol into `watchlist`, owned by its list, active.
insert into public.watchlist (symbol, active, watchlist_id)
select s.symbol, true, w.id
from _seed s
join public.watchlists w on w.slot = s.slot
on conflict (symbol) do update
  set active = true,
      watchlist_id = excluded.watchlist_id;

commit;
