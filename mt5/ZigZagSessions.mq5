//+------------------------------------------------------------------+
//|                                               ZigZagSessions.mq5 |
//|                                                                  |
//|  ZigZag with confirmed pivots + live leg, session boxes,         |
//|  previous-session high/low lines and HH/HL/LH/LL labels.         |
//|                                                                  |
//|  HOW IT BEHAVES (read this before trusting it in a backtest)     |
//|                                                                  |
//|  ZigZag                                                          |
//|  - A swing high is confirmed on the first CLOSED bar where price |
//|    has dropped from that high by the reversal threshold (ATR     |
//|    multiple, points or percent). Swing lows mirror this.         |
//|  - Once confirmed, a pivot never moves (no repaint). The solid   |
//|    line only connects confirmed pivots.                          |
//|  - The grey dot sits on the bar where the pivot became known, at |
//|    the pivot's price. The horizontal gap between pivot and dot   |
//|    is the real lag: you could not have known it earlier.         |
//|  - The dotted line is the live leg: last confirmed pivot to the  |
//|    current extreme. It can still move.                           |
//|  - Same-bar rule: a bar that makes a new extreme cannot also     |
//|    confirm the reversal with its opposite wick, because the      |
//|    order of high and low inside one bar is unknown. Side effect: |
//|    a very wide outside bar can poke past a confirmed pivot while |
//|    the line does not follow it (rare at 2x ATR and above).       |
//|  - Labels are written when a pivot is confirmed and never change.|
//|                                                                  |
//|  Sessions                                                        |
//|  - Hours are entered in UTC for standard (winter) time. A DST    |
//|    rule shifts the session one hour earlier in UTC during summer,|
//|    so it stays fixed in local exchange time.                     |
//|  - Bar times are broker server time. "Session clock" converts    |
//|    them to UTC:                                                  |
//|      Auto    - today's server offset applied to all history.     |
//|                Wrong for half the year if your broker shifts     |
//|                its clock for DST. In the Strategy Tester         |
//|                TimeGMT() equals server time, so Auto gives 0.    |
//|      Manual  - fixed offset you type in.                         |
//|      Broker GMT+2/+3 - common "New York close" brokers that      |
//|                follow US DST.                                    |
//|  - Boxes are built only from bars already on the chart; the box  |
//|    of a running session grows with each bar.                     |
//|  - Sessions are drawn on H1 and lower timeframes only.           |
//+------------------------------------------------------------------+
#property copyright   ""
#property version     "1.00"
#property description "ZigZag with confirmed pivots and a live leg, session boxes,"
#property description "previous session high/low lines and HH/HL/LH/LL labels."
#property indicator_chart_window
#property indicator_buffers 3
#property indicator_plots   3

#property indicator_label1  "ZigZag"
#property indicator_type1   DRAW_SECTION
#property indicator_color1  clrGold
#property indicator_style1  STYLE_SOLID
#property indicator_width1  2

#property indicator_label2  "ZigZag live leg"
#property indicator_type2   DRAW_SECTION
#property indicator_color2  clrGold
#property indicator_style2  STYLE_DOT
#property indicator_width2  1

#property indicator_label3  "Pivot confirmed at"
#property indicator_type3   DRAW_ARROW
#property indicator_color3  clrDarkGray
#property indicator_width3  1

//--- enums
enum ENUM_ZZ_THRESHOLD
  {
   THR_ATR     = 0, // ATR multiple
   THR_POINTS  = 1, // Fixed points
   THR_PERCENT = 2  // Percent of price
  };

enum ENUM_TIME_BASE
  {
   TB_AUTO      = 0, // Auto (current server offset, fixed)
   TB_MANUAL    = 1, // Manual fixed offset
   TB_BROKER_NY = 2  // Broker GMT+2/+3 (follows US DST)
  };

enum ENUM_DST_RULE
  {
   DST_NONE = 0, // None
   DST_EU   = 1, // Europe (last Sun Mar - last Sun Oct)
   DST_US   = 2  // US (2nd Sun Mar - 1st Sun Nov)
  };

//--- inputs
input group "ZigZag"
input ENUM_ZZ_THRESHOLD InpThrMode     = THR_ATR;  // Reversal threshold
input int               InpAtrPeriod   = 14;       // ATR period
input double            InpAtrMult     = 2.0;      // ATR multiple
input double            InpPoints      = 300;      // Points (fixed mode)
input double            InpPercent     = 0.5;      // Percent (percent mode)
input color             InpZZColor     = clrGold;  // Line color
input int               InpZZWidth     = 2;        // Line width
input bool              InpShowLive    = true;     // Show live (unconfirmed) leg
input bool              InpShowConfirm = true;     // Mark bar where pivot was confirmed

input group "Swing labels"
input bool  InpLabels    = true;              // Show HH / HL / LH / LL
input color InpLabelBull = clrMediumSeaGreen; // HH / HL color
input color InpLabelBear = clrIndianRed;      // LH / LL color
input int   InpLabelSize = 8;                 // Font size

input group "Session clock"
input ENUM_TIME_BASE InpTimeBase  = TB_AUTO; // Server time -> UTC
input double         InpUtcOffset = 0.0;     // Manual: server UTC offset (hours)

input group "Asia session (UTC, standard time)"
input bool          InpAsiaOn    = true;          // Enabled
input string        InpAsiaStart = "00:00";       // Start HH:MM
input string        InpAsiaEnd   = "09:00";       // End HH:MM
input ENUM_DST_RULE InpAsiaDst   = DST_NONE;      // Follow DST
input color         InpAsiaColor = C'80,120,200'; // Color

input group "London session (UTC, standard time)"
input bool          InpLonOn    = true;          // Enabled
input string        InpLonStart = "08:00";       // Start HH:MM
input string        InpLonEnd   = "17:00";       // End HH:MM
input ENUM_DST_RULE InpLonDst   = DST_EU;        // Follow DST
input color         InpLonColor = C'210,150,70'; // Color

input group "New York session (UTC, standard time)"
input bool          InpNyOn    = true;          // Enabled
input string        InpNyStart = "13:00";       // Start HH:MM
input string        InpNyEnd   = "22:00";       // End HH:MM
input ENUM_DST_RULE InpNyDst   = DST_US;        // Follow DST
input color         InpNyColor = C'70,180,140'; // Color

input group "Session display"
input bool   InpBoxes        = true;   // Session boxes
input bool   InpBoxFill      = true;   // Fill boxes
input int    InpFillPct      = 20;     // Fill strength (% of color over background)
input bool   InpSessionNames = true;   // Session names on boxes
input bool   InpPrevLines    = true;   // Previous session high/low lines
input bool   InpLatestOnly   = true;   // Lines: latest session only
input int    InpObjDays      = 20;     // Draw objects for last N days
input string InpPrefix       = "ZZS_"; // Object name prefix

//--- buffers
double ZZ[];      // confirmed pivots
double ZZLive[];  // live leg (2 points)
double ZZConf[];  // confirmation markers

//--- zigzag state (committed on closed bars only)
struct ZZState
  {
   int               dir;         // 0 = no pivot yet, +1 = up leg, -1 = down leg
   bool              started;
   // before the first pivot: track both sides
   double            hi;
   int               hiBar;
   double            lowAfterHi;
   double            lo;
   int               loBar;
   double            highAfterLo;
   // inside a leg
   double            ext;         // candidate pivot (running extreme of the leg)
   int               extBar;
   double            opp;         // opposite extreme after extBar
   int               oppBar;
   // last confirmed pivot
   bool              hasPiv;
   int               pivBar;
   double            pivPrice;
   // for HH/HL/LH/LL
   bool              hasH;
   double            prevH;
   bool              hasL;
   double            prevL;
  };
ZZState z;

//--- sessions
struct SessDef
  {
   bool              on;
   string            name;
   int               startMin;
   int               durMin;
   int               dst;
   color             clr;
  };
struct SessRun
  {
   bool              active;
   datetime          start;  // UTC
   datetime          end;    // UTC
   datetime          t1;     // server time of first bar
   datetime          t2;     // server time of last bar
   double            hi;
   double            lo;
  };
SessDef  g_def[3];
SessRun  g_run[3];
bool     g_hasLines[3];
datetime g_lineKey[3];

//--- misc state
int      g_atr        = INVALID_HANDLE;
int      g_next       = 0;      // next closed bar to process
datetime g_lastTime   = 0;      // time of bar g_next-1, detects history changes
datetime g_objFrom    = 0;      // objects are drawn from this server time on
long     g_autoOffset = 0;
bool     g_offPrinted = false;
bool     g_sessOK     = false;
int      g_live[2];
color    g_bg         = clrBlack;

int      g_usYear = -1, g_euYear = -1;
datetime g_usStart, g_usEnd, g_euStart, g_euEnd;

//+------------------------------------------------------------------+
//| Helpers: time                                                    |
//+------------------------------------------------------------------+
datetime MakeDate(const int y, const int mo, const int d)
  {
   MqlDateTime m;
   ZeroMemory(m);
   m.year = y;
   m.mon  = mo;
   m.day  = d;
   return StructToTime(m);
  }

int DayOfWeek(const datetime t)
  {
   MqlDateTime m;
   TimeToStruct(t, m);
   return m.day_of_week; // 0 = Sunday
  }

datetime NthSunday(const int y, const int mo, const int n)
  {
   datetime first = MakeDate(y, mo, 1);
   int offsetDays = (7 - DayOfWeek(first)) % 7 + 7 * (n - 1);
   return (datetime)((long)first + (long)offsetDays * 86400);
  }

datetime LastSunday(const int y, const int mo)
  {
   int ny = (mo == 12) ? y + 1 : y;
   int nm = (mo == 12) ? 1 : mo + 1;
   long last = (long)MakeDate(ny, nm, 1) - 86400;
   return (datetime)(last - (long)DayOfWeek((datetime)last) * 86400);
  }

bool IsDst(const int rule, const datetime utc)
  {
   if(rule == DST_NONE)
      return false;
   MqlDateTime m;
   TimeToStruct(utc, m);
   if(rule == DST_US)
     {
      if(m.year != g_usYear)
        {
         g_usYear  = m.year;
         g_usStart = (datetime)((long)NthSunday(m.year, 3, 2) + 7 * 3600);  // 02:00 EST
         g_usEnd   = (datetime)((long)NthSunday(m.year, 11, 1) + 6 * 3600); // 02:00 EDT
        }
      return utc >= g_usStart && utc < g_usEnd;
     }
   if(m.year != g_euYear)
     {
      g_euYear  = m.year;
      g_euStart = (datetime)((long)LastSunday(m.year, 3) + 3600);  // 01:00 UTC
      g_euEnd   = (datetime)((long)LastSunday(m.year, 10) + 3600); // 01:00 UTC
     }
   return utc >= g_euStart && utc < g_euEnd;
  }

datetime ToUtc(const datetime server)
  {
   long t = (long)server;
   if(InpTimeBase == TB_MANUAL)
      return (datetime)(t - (long)MathRound(InpUtcOffset * 3600.0));
   if(InpTimeBase == TB_AUTO)
      return (datetime)(t - g_autoOffset);
   long approx = t - 2 * 3600;
   return (datetime)(approx - (IsDst(DST_US, (datetime)approx) ? 3600 : 0));
  }

// UTC start of the session instance that contains utc, or 0
datetime SessionStart(const int s, const datetime utc)
  {
   long u    = (long)utc;
   long day0 = u - u % 86400;
   for(int k = -1; k <= 1; k++)
     {
      long d     = day0 + (long)k * 86400;
      int  shift = IsDst(g_def[s].dst, (datetime)(d + 12 * 3600)) ? 60 : 0;
      long st    = d + (long)(g_def[s].startMin - shift) * 60;
      if(u >= st && u < st + (long)g_def[s].durMin * 60)
         return (datetime)st;
     }
   return 0;
  }

bool ParseHM(const string text, int &mins)
  {
   string p[];
   if(StringSplit(text, ':', p) != 2)
      return false;
   StringTrimLeft(p[0]);
   StringTrimRight(p[0]);
   StringTrimLeft(p[1]);
   StringTrimRight(p[1]);
   if(StringLen(p[0]) == 0 || StringLen(p[1]) == 0)
      return false;
   int h = (int)StringToInteger(p[0]);
   int m = (int)StringToInteger(p[1]);
   if(h < 0 || h > 23 || m < 0 || m > 59)
      return false;
   mins = h * 60 + m;
   return true;
  }

bool SetupSession(const int s, const string name, const bool on, const string a,
                  const string b, const ENUM_DST_RULE dst, const color c)
  {
   g_def[s].name     = name;
   g_def[s].on       = on;
   g_def[s].dst      = (int)dst;
   g_def[s].clr      = c;
   g_def[s].startMin = 0;
   g_def[s].durMin   = 0;
   if(!on)
      return true;
   int st = 0, en = 0;
   if(!ParseHM(a, st) || !ParseHM(b, en))
     {
      PrintFormat("%s session: times must be HH:MM, got '%s' - '%s'", name, a, b);
      return false;
     }
   int dur = (en - st + 1440) % 1440;
   if(dur == 0)
     {
      PrintFormat("%s session: start and end are equal", name);
      return false;
     }
   g_def[s].startMin = st;
   g_def[s].durMin   = dur;
   return true;
  }

//+------------------------------------------------------------------+
//| Helpers: drawing                                                 |
//+------------------------------------------------------------------+
color Blend(const color fg, const color bg, const int pct)
  {
   int    a = (int)fg, b = (int)bg;
   double w = MathMax(0.0, MathMin(100.0, (double)pct)) / 100.0;
   int r  = (int)MathRound((a & 0xFF) * w + (b & 0xFF) * (1.0 - w));
   int g  = (int)MathRound(((a >> 8) & 0xFF) * w + ((b >> 8) & 0xFF) * (1.0 - w));
   int bl = (int)MathRound(((a >> 16) & 0xFF) * w + ((b >> 16) & 0xFF) * (1.0 - w));
   return (color)(r | (g << 8) | (bl << 16));
  }

void SetCommon(const string n, const bool back)
  {
   ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, n, OBJPROP_BACK, back);
  }

void Text(const string n, const datetime t, const double p, const string txt,
          const color c, const int size, const ENUM_ANCHOR_POINT anchor)
  {
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_TEXT, 0, t, p);
      SetCommon(n, false);
      ObjectSetString(0, n, OBJPROP_FONT, "Arial");
      ObjectSetInteger(0, n, OBJPROP_FONTSIZE, size);
      ObjectSetInteger(0, n, OBJPROP_ANCHOR, anchor);
      ObjectSetInteger(0, n, OBJPROP_COLOR, c);
     }
   else
      ObjectMove(0, n, 0, t, p);
   ObjectSetString(0, n, OBJPROP_TEXT, txt);
  }

string ObjId(const int s, const datetime key)
  {
   return IntegerToString(s) + "_" + IntegerToString((long)key);
  }

void DrawBox(const int s, const datetime key, const datetime t1, const datetime t2,
             const double hi, const double lo)
  {
   if(!InpBoxes)
      return;
   string n = InpPrefix + "B" + ObjId(s, key);
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_RECTANGLE, 0, t1, hi, t2, lo);
      SetCommon(n, true);
      ObjectSetInteger(0, n, OBJPROP_FILL, InpBoxFill);
      ObjectSetInteger(0, n, OBJPROP_COLOR,
                       InpBoxFill ? Blend(g_def[s].clr, g_bg, InpFillPct) : g_def[s].clr);
      ObjectSetString(0, n, OBJPROP_TOOLTIP, g_def[s].name + " session");
     }
   else
     {
      ObjectMove(0, n, 0, t1, hi);
      ObjectMove(0, n, 1, t2, lo);
     }
   if(InpSessionNames)
      Text(InpPrefix + "N" + ObjId(s, key), t1, hi, g_def[s].name, g_def[s].clr, 7, ANCHOR_LEFT_LOWER);
  }

string LineName(const int s, const datetime key, const string side)
  {
   return InpPrefix + side + ObjId(s, key);
  }

void HLine(const string n, const datetime t1, const datetime t2, const double p,
           const color c, const string tip)
  {
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_TREND, 0, t1, p, t2, p);
      SetCommon(n, true);
      ObjectSetInteger(0, n, OBJPROP_RAY_RIGHT, false);
      ObjectSetInteger(0, n, OBJPROP_STYLE, STYLE_DOT);
      ObjectSetInteger(0, n, OBJPROP_WIDTH, 1);
      ObjectSetInteger(0, n, OBJPROP_COLOR, c);
      ObjectSetString(0, n, OBJPROP_TOOLTIP, tip);
     }
   else
     {
      ObjectMove(0, n, 0, t1, p);
      ObjectMove(0, n, 1, t2, p);
     }
  }

//+------------------------------------------------------------------+
//| ZigZag                                                           |
//+------------------------------------------------------------------+
double Thr(const double atrv, const double ref)
  {
   if(InpThrMode == THR_ATR)
      return (atrv > 0.0 && atrv != EMPTY_VALUE) ? atrv * InpAtrMult : -1.0;
   if(InpThrMode == THR_POINTS)
      return InpPoints * _Point;
   return MathAbs(ref) * InpPercent / 100.0;
  }

void Confirm(const int type, const int bar, const double price, const int confBar,
             const datetime &time[])
  {
   ZZ[bar] = price;
   if(InpShowConfirm)
      ZZConf[confBar] = price;

   double eps = _Point * 0.5;
   string txt = "";
   color  c   = clrGray;
   if(type > 0)
     {
      if(!z.hasH)                   { txt = "H";   c = clrGray; }
      else if(price > z.prevH + eps) { txt = "HH";  c = InpLabelBull; }
      else if(price < z.prevH - eps) { txt = "LH";  c = InpLabelBear; }
      else                          { txt = "EQH"; c = clrGray; }
      z.hasH  = true;
      z.prevH = price;
     }
   else
     {
      if(!z.hasL)                   { txt = "L";   c = clrGray; }
      else if(price > z.prevL + eps) { txt = "HL";  c = InpLabelBull; }
      else if(price < z.prevL - eps) { txt = "LL";  c = InpLabelBear; }
      else                          { txt = "EQL"; c = clrGray; }
      z.hasL  = true;
      z.prevL = price;
     }
   z.hasPiv   = true;
   z.pivBar   = bar;
   z.pivPrice = price;

   if(InpLabels && time[bar] >= g_objFrom)
      Text(InpPrefix + "P" + IntegerToString((long)time[bar]) + (type > 0 ? "H" : "L"),
           time[bar], price, txt, c, InpLabelSize, type > 0 ? ANCHOR_LOWER : ANCHOR_UPPER);
  }

// New leg after a pivot at pivBar, rebuilt from bars (pivBar, i]
void StartLeg(const int dir, const int pivBar, const int i,
              const double &high[], const double &low[])
  {
   z.dir = dir;
   if(dir < 0)
     {
      z.ext = DBL_MAX;
      z.extBar = -1;
      for(int j = pivBar + 1; j <= i; j++)
         if(low[j] < z.ext) { z.ext = low[j]; z.extBar = j; }
      z.opp = -DBL_MAX;
      z.oppBar = -1;
      for(int j = z.extBar + 1; j <= i; j++)
         if(high[j] > z.opp) { z.opp = high[j]; z.oppBar = j; }
     }
   else
     {
      z.ext = -DBL_MAX;
      z.extBar = -1;
      for(int j = pivBar + 1; j <= i; j++)
         if(high[j] > z.ext) { z.ext = high[j]; z.extBar = j; }
      z.opp = DBL_MAX;
      z.oppBar = -1;
      for(int j = z.extBar + 1; j <= i; j++)
         if(low[j] < z.opp) { z.opp = low[j]; z.oppBar = j; }
     }
  }

// Process one CLOSED bar
void ZZBar(const int i, const datetime &time[], const double &high[], const double &low[],
           const double atrv)
  {
   if(z.dir == 0)
     {
      if(!z.started)
        {
         z.started     = true;
         z.hi          = high[i];
         z.hiBar       = i;
         z.lowAfterHi  = DBL_MAX;
         z.lo          = low[i];
         z.loBar       = i;
         z.highAfterLo = -DBL_MAX;
         return;
        }
      if(high[i] > z.hi) { z.hi = high[i]; z.hiBar = i; z.lowAfterHi = DBL_MAX; }
      else if(low[i] < z.lowAfterHi) z.lowAfterHi = low[i];
      if(low[i] < z.lo) { z.lo = low[i]; z.loBar = i; z.highAfterLo = -DBL_MAX; }
      else if(high[i] > z.highAfterLo) z.highAfterLo = high[i];

      double tHi = Thr(atrv, z.hi), tLo = Thr(atrv, z.lo);
      bool downRev = tHi > 0 && z.lowAfterHi != DBL_MAX && z.hi - z.lowAfterHi >= tHi;
      bool upRev   = tLo > 0 && z.highAfterLo != -DBL_MAX && z.highAfterLo - z.lo >= tLo;
      if(downRev && (!upRev || z.hiBar <= z.loBar))
        {
         Confirm(+1, z.hiBar, z.hi, i, time);
         StartLeg(-1, z.hiBar, i, high, low);
        }
      else if(upRev)
        {
         Confirm(-1, z.loBar, z.lo, i, time);
         StartLeg(+1, z.loBar, i, high, low);
        }
      else
         return;
     }
   else if(z.dir > 0)
     {
      if(high[i] > z.ext) { z.ext = high[i]; z.extBar = i; z.opp = DBL_MAX; z.oppBar = -1; }
      else if(low[i] < z.opp) { z.opp = low[i]; z.oppBar = i; }
     }
   else
     {
      if(low[i] < z.ext) { z.ext = low[i]; z.extBar = i; z.opp = -DBL_MAX; z.oppBar = -1; }
      else if(high[i] > z.opp) { z.opp = high[i]; z.oppBar = i; }
     }

   // a reversal can confirm more than one pivot on the same bar (cascade)
   for(int guard = 0; guard < 100; guard++)
     {
      if(z.oppBar < 0)
         break;
      double t = Thr(atrv, z.ext);
      if(t <= 0 || MathAbs(z.ext - z.opp) < t)
         break;
      int    type  = z.dir;
      int    pBar  = z.extBar;
      double price = z.ext;
      Confirm(type, pBar, price, i, time);
      StartLeg(-type, pBar, i, high, low);
     }
  }

// Live leg uses the forming bar but never commits state
void RenderLive(const int f, const double &high[], const double &low[])
  {
   for(int k = 0; k < 2; k++)
     {
      if(g_live[k] >= 0 && g_live[k] < ArraySize(ZZLive))
         ZZLive[g_live[k]] = EMPTY_VALUE;
      g_live[k] = -1;
     }
   if(!InpShowLive || z.dir == 0 || !z.hasPiv)
      return;
   double e  = z.ext;
   int    eb = z.extBar;
   if(z.dir > 0 && high[f] > e) { e = high[f]; eb = f; }
   if(z.dir < 0 && low[f] < e)  { e = low[f];  eb = f; }
   if(eb <= z.pivBar)
      return;
   ZZLive[z.pivBar] = z.pivPrice;
   ZZLive[eb]       = e;
   g_live[0] = z.pivBar;
   g_live[1] = eb;
  }

//+------------------------------------------------------------------+
//| Sessions                                                         |
//+------------------------------------------------------------------+
void SessFinalize(const int s)
  {
   datetime xEnd = (datetime)((long)g_run[s].t2 + PeriodSeconds());
   DrawBox(s, g_run[s].start, g_run[s].t1, xEnd, g_run[s].hi, g_run[s].lo);
   if(InpPrevLines)
     {
      if(g_hasLines[s])
        {
         string h = LineName(s, g_lineKey[s], "H");
         string l = LineName(s, g_lineKey[s], "L");
         if(InpLatestOnly)
           {
            ObjectDelete(0, h);
            ObjectDelete(0, l);
           }
         else
           {
            ObjectSetInteger(0, h, OBJPROP_TIME, 1, xEnd);
            ObjectSetInteger(0, l, OBJPROP_TIME, 1, xEnd);
           }
        }
      HLine(LineName(s, g_run[s].start, "H"), xEnd, xEnd, g_run[s].hi, g_def[s].clr, g_def[s].name + " high");
      HLine(LineName(s, g_run[s].start, "L"), xEnd, xEnd, g_run[s].lo, g_def[s].clr, g_def[s].name + " low");
      g_hasLines[s] = true;
      g_lineKey[s]  = g_run[s].start;
     }
   g_run[s].active = false;
  }

// Process one CLOSED bar
void SessBar(const int i, const datetime &time[], const double &high[], const double &low[])
  {
   datetime u = ToUtc(time[i]);
   for(int s = 0; s < 3; s++)
     {
      if(!g_def[s].on)
         continue;
      if(g_run[s].active && u >= g_run[s].end)
         SessFinalize(s);
      datetime st = SessionStart(s, u);
      if(st == 0)
         continue;
      if(g_run[s].active && g_run[s].start != st)
         SessFinalize(s);
      if(!g_run[s].active)
        {
         g_run[s].active = true;
         g_run[s].start  = st;
         g_run[s].end    = (datetime)((long)st + (long)g_def[s].durMin * 60);
         g_run[s].t1     = time[i];
         g_run[s].t2     = time[i];
         g_run[s].hi     = high[i];
         g_run[s].lo     = low[i];
        }
      else
        {
         g_run[s].t2 = time[i];
         if(high[i] > g_run[s].hi) g_run[s].hi = high[i];
         if(low[i] < g_run[s].lo)  g_run[s].lo = low[i];
        }
     }
  }

// Draw running sessions including the forming bar; only time-based state is committed
void SessRender(const int f, const datetime &time[], const double &high[], const double &low[])
  {
   int      ps   = PeriodSeconds();
   datetime u    = ToUtc(time[f]);
   datetime xNow = (datetime)((long)time[f] + ps);
   for(int s = 0; s < 3; s++)
     {
      if(!g_def[s].on)
         continue;
      // the forming bar's open time never changes, so ending a session on it is safe
      if(g_run[s].active && u >= g_run[s].end)
         SessFinalize(s);
      datetime st = SessionStart(s, u);
      if(st != 0)
        {
         double   hi = high[f], lo = low[f];
         datetime t1 = time[f];
         if(g_run[s].active && g_run[s].start == st)
           {
            hi = MathMax(hi, g_run[s].hi);
            lo = MathMin(lo, g_run[s].lo);
            t1 = g_run[s].t1;
           }
         DrawBox(s, st, t1, xNow, hi, lo);
        }
      else if(g_run[s].active)
         DrawBox(s, g_run[s].start, g_run[s].t1, (datetime)((long)g_run[s].t2 + ps), g_run[s].hi, g_run[s].lo);

      if(InpPrevLines && g_hasLines[s])
        {
         ObjectSetInteger(0, LineName(s, g_lineKey[s], "H"), OBJPROP_TIME, 1, xNow);
         ObjectSetInteger(0, LineName(s, g_lineKey[s], "L"), OBJPROP_TIME, 1, xNow);
        }
     }
  }

//+------------------------------------------------------------------+
//| Reset                                                            |
//+------------------------------------------------------------------+
void ResetAll(const int rates_total, const datetime &time[])
  {
   ObjectsDeleteAll(0, InpPrefix);
   ArrayInitialize(ZZ, EMPTY_VALUE);
   ArrayInitialize(ZZLive, EMPTY_VALUE);
   ArrayInitialize(ZZConf, EMPTY_VALUE);
   ZeroMemory(z);
   for(int s = 0; s < 3; s++)
     {
      g_run[s].active = false;
      g_hasLines[s]   = false;
      g_lineKey[s]    = 0;
     }
   g_live[0]  = -1;
   g_live[1]  = -1;
   g_next     = 0;
   g_lastTime = 0;
   g_bg       = (color)ChartGetInteger(0, CHART_COLOR_BACKGROUND);

   long from = (long)time[rates_total - 1] - (long)InpObjDays * 86400;
   g_objFrom = (datetime)(from - from % 86400);

   if(InpTimeBase == TB_AUTO)
     {
      long diff = (long)TimeTradeServer() - (long)TimeGMT();
      long off  = (long)MathRound(diff / 1800.0) * 1800;
      if(!g_offPrinted || off != g_autoOffset)
         PrintFormat("ZigZag Sessions: server time = UTC%+.1f h (auto). "
                     "If your broker shifts its clock for DST, use Broker GMT+2/+3 or Manual.",
                     off / 3600.0);
      g_autoOffset = off;
      g_offPrinted = true;
     }
  }

//+------------------------------------------------------------------+
//| Init / deinit                                                    |
//+------------------------------------------------------------------+
int OnInit()
  {
   SetIndexBuffer(0, ZZ, INDICATOR_DATA);
   SetIndexBuffer(1, ZZLive, INDICATOR_DATA);
   SetIndexBuffer(2, ZZConf, INDICATOR_DATA);
   ArraySetAsSeries(ZZ, false);
   ArraySetAsSeries(ZZLive, false);
   ArraySetAsSeries(ZZConf, false);
   for(int k = 0; k < 3; k++)
      PlotIndexSetDouble(k, PLOT_EMPTY_VALUE, EMPTY_VALUE);

   PlotIndexSetInteger(0, PLOT_LINE_COLOR, InpZZColor);
   PlotIndexSetInteger(0, PLOT_LINE_WIDTH, MathMax(1, InpZZWidth));
   PlotIndexSetInteger(1, PLOT_LINE_COLOR, InpZZColor);
   PlotIndexSetInteger(2, PLOT_ARROW, 159);
   if(!InpShowLive)
      PlotIndexSetInteger(1, PLOT_DRAW_TYPE, DRAW_NONE);
   if(!InpShowConfirm)
      PlotIndexSetInteger(2, PLOT_DRAW_TYPE, DRAW_NONE);

   if(InpThrMode == THR_ATR && (InpAtrPeriod < 1 || InpAtrMult <= 0))
     { Print("ATR period must be >= 1 and ATR multiple > 0"); return INIT_PARAMETERS_INCORRECT; }
   if(InpThrMode == THR_POINTS && InpPoints <= 0)
     { Print("Points must be > 0"); return INIT_PARAMETERS_INCORRECT; }
   if(InpThrMode == THR_PERCENT && InpPercent <= 0)
     { Print("Percent must be > 0"); return INIT_PARAMETERS_INCORRECT; }
   if(InpObjDays < 1)
     { Print("Draw objects for last N days must be >= 1"); return INIT_PARAMETERS_INCORRECT; }
   if(StringLen(InpPrefix) == 0)
     { Print("Object name prefix cannot be empty"); return INIT_PARAMETERS_INCORRECT; }

   if(!SetupSession(0, "Asia", InpAsiaOn, InpAsiaStart, InpAsiaEnd, InpAsiaDst, InpAsiaColor) ||
      !SetupSession(1, "London", InpLonOn, InpLonStart, InpLonEnd, InpLonDst, InpLonColor) ||
      !SetupSession(2, "New York", InpNyOn, InpNyStart, InpNyEnd, InpNyDst, InpNyColor))
      return INIT_PARAMETERS_INCORRECT;

   bool anyOn = InpAsiaOn || InpLonOn || InpNyOn;
   g_sessOK   = anyOn && (InpBoxes || InpPrevLines) && PeriodSeconds() <= PeriodSeconds(PERIOD_H1);
   if(anyOn && (InpBoxes || InpPrevLines) && !g_sessOK)
      Print("ZigZag Sessions: sessions are drawn on H1 and lower timeframes only");

   if(InpThrMode == THR_ATR)
     {
      g_atr = iATR(_Symbol, _Period, InpAtrPeriod);
      if(g_atr == INVALID_HANDLE)
        { Print("Could not create ATR handle"); return INIT_FAILED; }
     }

   g_live[0] = -1;
   g_live[1] = -1;
   IndicatorSetString(INDICATOR_SHORTNAME, "ZigZag Sessions");
   IndicatorSetInteger(INDICATOR_DIGITS, _Digits);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   ObjectsDeleteAll(0, InpPrefix);
   if(g_atr != INVALID_HANDLE)
      IndicatorRelease(g_atr);
  }

//+------------------------------------------------------------------+
//| Main                                                             |
//+------------------------------------------------------------------+
int OnCalculate(const int rates_total,
                const int prev_calculated,
                const datetime &time[],
                const double &open[],
                const double &high[],
                const double &low[],
                const double &close[],
                const long &tick_volume[],
                const long &volume[],
                const int &spread[])
  {
   if(rates_total < 3)
      return 0;
   ArraySetAsSeries(time, false);
   ArraySetAsSeries(high, false);
   ArraySetAsSeries(low, false);

   bool reset = (prev_calculated == 0);
   if(!reset && g_next > 0 && (g_next - 1 >= rates_total || time[g_next - 1] != g_lastTime))
      reset = true; // history was reloaded or shifted
   if(reset)
      ResetAll(rates_total, time);
   else
      for(int k = prev_calculated; k < rates_total; k++)
        {
         ZZ[k]     = EMPTY_VALUE;
         ZZLive[k] = EMPTY_VALUE;
         ZZConf[k] = EMPTY_VALUE;
        }

   int last = rates_total - 2; // last closed bar
   double atr[];
   if(InpThrMode == THR_ATR && last >= g_next)
     {
      if(BarsCalculated(g_atr) < rates_total)
         return 0;
      int count = rates_total - g_next;
      ArraySetAsSeries(atr, false);
      if(CopyBuffer(g_atr, 0, 0, count, atr) != count)
         return 0;
     }

   for(int i = g_next; i <= last; i++)
     {
      double a = (InpThrMode == THR_ATR) ? atr[i - g_next] : 0.0;
      ZZBar(i, time, high, low, a);
      if(g_sessOK && time[i] >= g_objFrom)
         SessBar(i, time, high, low);
     }
   if(last >= g_next)
      g_next = last + 1;
   if(g_next > 0)
      g_lastTime = time[g_next - 1];

   int f = rates_total - 1; // forming bar
   RenderLive(f, high, low);
   if(g_sessOK)
      SessRender(f, time, high, low);
   if(reset)
      ChartRedraw();
   return rates_total;
  }
//+------------------------------------------------------------------+
