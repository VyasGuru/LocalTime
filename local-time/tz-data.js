// Location → IANA time zone resolver for LinkedIn-style location strings.
// e.g. "Bengaluru, Karnataka, India", "Austin, Texas, United States",
//      "San Francisco Bay Area", "Greater London", "Dallas-Fort Worth Metroplex".
(function (global) {
  "use strict";

  const KYIV_TZ = validTz("Europe/Kyiv") ? "Europe/Kyiv" : "Europe/Kiev";

  // ---------- Countries ----------
  // "alias|alias:Zone"  (single-zone countries, or countries where one zone covers nearly everyone)
  const COUNTRY_LINES = `
afghanistan:Asia/Kabul
albania:Europe/Tirane
algeria:Africa/Algiers
andorra:Europe/Andorra
angola:Africa/Luanda
antigua and barbuda:America/Antigua
argentina:America/Argentina/Buenos_Aires
armenia:Asia/Yerevan
aruba:America/Aruba
austria:Europe/Vienna
azerbaijan:Asia/Baku
bahamas|the bahamas:America/Nassau
bahrain:Asia/Bahrain
bangladesh:Asia/Dhaka
barbados:America/Barbados
belarus:Europe/Minsk
belgium:Europe/Brussels
belize:America/Belize
benin:Africa/Porto-Novo
bermuda:Atlantic/Bermuda
bhutan:Asia/Thimphu
bolivia:America/La_Paz
bosnia and herzegovina|bosnia:Europe/Sarajevo
botswana:Africa/Gaborone
brunei|brunei darussalam:Asia/Brunei
bulgaria:Europe/Sofia
burkina faso:Africa/Ouagadougou
burundi:Africa/Bujumbura
cambodia:Asia/Phnom_Penh
cameroon:Africa/Douala
cape verde|cabo verde:Atlantic/Cape_Verde
cayman islands:America/Cayman
central african republic:Africa/Bangui
chad:Africa/Ndjamena
china|peoples republic of china|mainland china|prc:Asia/Shanghai
colombia:America/Bogota
comoros:Indian/Comoro
congo|republic of the congo|congo-brazzaville:Africa/Brazzaville
costa rica:America/Costa_Rica
cote divoire|ivory coast:Africa/Abidjan
croatia:Europe/Zagreb
cuba:America/Havana
curacao:America/Curacao
cyprus:Asia/Nicosia
czechia|czech republic:Europe/Prague
denmark:Europe/Copenhagen
djibouti:Africa/Djibouti
dominica:America/Dominica
dominican republic:America/Santo_Domingo
egypt:Africa/Cairo
el salvador:America/El_Salvador
equatorial guinea:Africa/Malabo
eritrea:Africa/Asmara
estonia:Europe/Tallinn
eswatini|swaziland:Africa/Mbabane
ethiopia:Africa/Addis_Ababa
fiji:Pacific/Fiji
finland:Europe/Helsinki
france:Europe/Paris
french guiana:America/Cayenne
gabon:Africa/Libreville
gambia|the gambia:Africa/Banjul
georgia:Asia/Tbilisi
germany|deutschland:Europe/Berlin
ghana:Africa/Accra
gibraltar:Europe/Gibraltar
greece:Europe/Athens
grenada:America/Grenada
guadeloupe:America/Guadeloupe
guam:Pacific/Guam
guatemala:America/Guatemala
guernsey:Europe/Guernsey
guinea:Africa/Conakry
guinea-bissau:Africa/Bissau
guyana:America/Guyana
haiti:America/Port-au-Prince
honduras:America/Tegucigalpa
hong kong|hong kong sar:Asia/Hong_Kong
hungary:Europe/Budapest
iceland:Atlantic/Reykjavik
india|bharat:Asia/Kolkata
iran:Asia/Tehran
iraq:Asia/Baghdad
ireland|republic of ireland:Europe/Dublin
isle of man:Europe/Isle_of_Man
israel:Asia/Jerusalem
italy|italia:Europe/Rome
jamaica:America/Jamaica
japan:Asia/Tokyo
jersey:Europe/Jersey
jordan:Asia/Amman
kazakhstan:Asia/Almaty
kenya:Africa/Nairobi
kosovo:Europe/Belgrade
kuwait:Asia/Kuwait
kyrgyzstan:Asia/Bishkek
laos:Asia/Vientiane
latvia:Europe/Riga
lebanon:Asia/Beirut
lesotho:Africa/Maseru
liberia:Africa/Monrovia
libya:Africa/Tripoli
liechtenstein:Europe/Vaduz
lithuania:Europe/Vilnius
luxembourg:Europe/Luxembourg
macao|macau:Asia/Macau
madagascar:Indian/Antananarivo
malawi:Africa/Blantyre
malaysia:Asia/Kuala_Lumpur
maldives:Indian/Maldives
mali:Africa/Bamako
malta:Europe/Malta
martinique:America/Martinique
mauritania:Africa/Nouakchott
mauritius:Indian/Mauritius
moldova:Europe/Chisinau
monaco:Europe/Monaco
montenegro:Europe/Podgorica
morocco:Africa/Casablanca
mozambique:Africa/Maputo
myanmar|burma:Asia/Yangon
namibia:Africa/Windhoek
nepal:Asia/Kathmandu
netherlands|the netherlands|holland|nederland:Europe/Amsterdam
new caledonia:Pacific/Noumea
nicaragua:America/Managua
niger:Africa/Niamey
nigeria:Africa/Lagos
north korea:Asia/Pyongyang
north macedonia|macedonia:Europe/Skopje
norway:Europe/Oslo
oman:Asia/Muscat
pakistan:Asia/Karachi
palestine|palestinian territories|state of palestine|palestinian territory:Asia/Hebron
panama:America/Panama
paraguay:America/Asuncion
peru:America/Lima
philippines:Asia/Manila
poland|polska:Europe/Warsaw
puerto rico:America/Puerto_Rico
qatar:Asia/Qatar
reunion:Indian/Reunion
romania:Europe/Bucharest
rwanda:Africa/Kigali
saint lucia:America/St_Lucia
samoa:Pacific/Apia
san marino:Europe/San_Marino
saudi arabia|ksa|kingdom of saudi arabia:Asia/Riyadh
senegal:Africa/Dakar
serbia:Europe/Belgrade
seychelles:Indian/Mahe
sierra leone:Africa/Freetown
singapore:Asia/Singapore
slovakia:Europe/Bratislava
slovenia:Europe/Ljubljana
somalia:Africa/Mogadishu
south africa:Africa/Johannesburg
south korea|korea|republic of korea:Asia/Seoul
south sudan:Africa/Juba
sri lanka:Asia/Colombo
sudan:Africa/Khartoum
suriname:America/Paramaribo
sweden|sverige:Europe/Stockholm
switzerland|schweiz|suisse:Europe/Zurich
syria:Asia/Damascus
taiwan:Asia/Taipei
tajikistan:Asia/Dushanbe
tanzania:Africa/Dar_es_Salaam
thailand:Asia/Bangkok
timor-leste|east timor:Asia/Dili
togo:Africa/Lome
tonga:Pacific/Tongatapu
trinidad and tobago:America/Port_of_Spain
tunisia:Africa/Tunis
turkey|turkiye:Europe/Istanbul
turkmenistan:Asia/Ashgabat
uganda:Africa/Kampala
ukraine:${KYIV_TZ}
united arab emirates|uae:Asia/Dubai
united kingdom|uk|england|scotland|wales|northern ireland|great britain|britain|gb:Europe/London
uruguay:America/Montevideo
uzbekistan:Asia/Tashkent
vanuatu:Pacific/Efate
venezuela:America/Caracas
vietnam|viet nam:Asia/Ho_Chi_Minh
yemen:Asia/Aden
zambia:Africa/Lusaka
zimbabwe:Africa/Harare
`;

  // Countries spanning several zones. `zones` = what to show when we only know the country;
  // `def` = use this single zone instead when nothing more specific is found.
  const MULTI = {
    us: { names: "united states|united states of america|usa|us|america", zones: ["America/Los_Angeles", "America/New_York"], label: "United States" },
    ca: { names: "canada", zones: ["America/Vancouver", "America/Toronto"], label: "Canada" },
    au: { names: "australia", zones: ["Australia/Perth", "Australia/Sydney"], label: "Australia" },
    br: { names: "brazil|brasil", def: "America/Sao_Paulo", approximate: true, label: "Brazil" },
    mx: { names: "mexico", def: "America/Mexico_City", approximate: true, label: "Mexico" },
    ru: { names: "russia|russian federation", zones: ["Europe/Kaliningrad", "Asia/Kamchatka"], label: "Russia" },
    id: { names: "indonesia", zones: ["Asia/Jakarta", "Asia/Jayapura"], label: "Indonesia" },
    cl: { names: "chile", zones: ["Pacific/Easter", "America/Santiago"], label: "Chile" },
    cd: { names: "democratic republic of the congo|dr congo|drc|congo-kinshasa", zones: ["Africa/Kinshasa", "Africa/Lubumbashi"], label: "Democratic Republic of the Congo" },
    ec: { names: "ecuador", zones: ["Pacific/Galapagos", "America/Guayaquil"], label: "Ecuador" },
    gl: { names: "greenland", zones: ["America/Thule", "America/Danmarkshavn"], label: "Greenland" },
    mn: { names: "mongolia", zones: ["Asia/Hovd", "Asia/Ulaanbaatar"], label: "Mongolia" },
    nz: { names: "new zealand|aotearoa", zones: ["Pacific/Auckland", "Pacific/Chatham"], label: "New Zealand" },
    pf: { names: "french polynesia", zones: ["Pacific/Tahiti", "Pacific/Gambier"], label: "French Polynesia" },
    pg: { names: "papua new guinea", zones: ["Pacific/Port_Moresby", "Pacific/Bougainville"], label: "Papua New Guinea" },
    pt: { names: "portugal", zones: ["Atlantic/Azores", "Europe/Lisbon"], label: "Portugal" },
    es: { names: "spain|espana", zones: ["Atlantic/Canary", "Europe/Madrid"], label: "Spain" },
  };

  // ---------- Regions (states/provinces) inside multi-zone countries ----------
  const REGION_LINES = {
    us: `
alabama|al:America/Chicago
alaska|ak:America/Anchorage
arizona|az:America/Phoenix
arkansas|ar:America/Chicago
california|ca:America/Los_Angeles
colorado|co:America/Denver
connecticut|ct:America/New_York
delaware|de:America/New_York
district of columbia|dc:America/New_York
florida|fl:America/New_York
georgia|ga:America/New_York
hawaii|hi:Pacific/Honolulu
idaho|id:America/Boise
illinois|il:America/Chicago
indiana|in:America/Indiana/Indianapolis
iowa|ia:America/Chicago
kansas|ks:America/Chicago
kentucky|ky:America/New_York
louisiana|la:America/Chicago
maine|me:America/New_York
maryland|md:America/New_York
massachusetts|ma:America/New_York
michigan|mi:America/Detroit
minnesota|mn:America/Chicago
mississippi|ms:America/Chicago
missouri|mo:America/Chicago
montana|mt:America/Denver
nebraska|ne:America/Chicago
nevada|nv:America/Los_Angeles
new hampshire|nh:America/New_York
new jersey|nj:America/New_York
new mexico|nm:America/Denver
new york|ny:America/New_York
north carolina|nc:America/New_York
north dakota|nd:America/Chicago
ohio|oh:America/New_York
oklahoma|ok:America/Chicago
oregon|or:America/Los_Angeles
pennsylvania|pa:America/New_York
rhode island|ri:America/New_York
south carolina|sc:America/New_York
south dakota|sd:America/Chicago
tennessee|tn:America/Chicago
texas|tx:America/Chicago
utah|ut:America/Denver
vermont|vt:America/New_York
virginia|va:America/New_York
washington|wa:America/Los_Angeles
west virginia|wv:America/New_York
wisconsin|wi:America/Chicago
wyoming|wy:America/Denver
`,
    ca: `
ontario|on:America/Toronto
quebec|qc:America/Toronto
british columbia|bc:America/Vancouver
alberta|ab:America/Edmonton
saskatchewan|sk:America/Regina
manitoba|mb:America/Winnipeg
nova scotia|ns:America/Halifax
new brunswick|nb:America/Moncton
newfoundland and labrador|newfoundland|nl:America/St_Johns
prince edward island|pei:America/Halifax
yukon:America/Whitehorse
northwest territories:America/Edmonton
nunavut:America/Iqaluit
`,
    au: `
new south wales|nsw:Australia/Sydney
australian capital territory|act:Australia/Sydney
victoria|vic:Australia/Melbourne
queensland|qld:Australia/Brisbane
western australia|wa:Australia/Perth
south australia|sa:Australia/Adelaide
tasmania|tas:Australia/Hobart
northern territory|nt:Australia/Darwin
`,
    br: `
amazonas:America/Manaus
mato grosso:America/Cuiaba
mato grosso do sul:America/Campo_Grande
rondonia:America/Porto_Velho
roraima:America/Boa_Vista
acre:America/Rio_Branco
`,
    mx: `
baja california:America/Tijuana
baja california sur:America/Mazatlan
sonora:America/Hermosillo
sinaloa:America/Mazatlan
nayarit:America/Mazatlan
chihuahua:America/Chihuahua
quintana roo:America/Cancun
`,
    id: `
bali:Asia/Makassar
south sulawesi|north sulawesi|central sulawesi|sulawesi:Asia/Makassar
east kalimantan|south kalimantan|north kalimantan:Asia/Makassar
west nusa tenggara|east nusa tenggara:Asia/Makassar
papua|west papua:Asia/Jayapura
maluku|north maluku:Asia/Jayapura
`,
    ru: ``,
  };

  // Cities in states split across zones — checked before the state.
  const EXCEPTION_LINES = {
    us: `
el paso:America/Denver
pensacola:America/Chicago
knoxville|chattanooga|tri-cities tn:America/New_York
louisville:America/Kentucky/Louisville
gary|evansville:America/Chicago
coeur dalene:America/Los_Angeles
rapid city:America/Denver
washington metropolitan area|washington dc metropolitan area|greater washington area|dc metro area:America/New_York
`,
    au: `
broken hill:Australia/Broken_Hill
`,
  };

  // Cities / metro areas. Format "alias|alias:Zone:cc"
  const CITY_LINES = `
new york|new york city|nyc|manhattan|brooklyn|queens|bronx|staten island:America/New_York:us
boston|cambridge ma|philadelphia|pittsburgh|baltimore|washington dc|washington d c|washington district of columbia|washington metropolitan area|washington dc metropolitan area|dc metro|dc metro area|dmv:America/New_York:us
atlanta|savannah|miami|fort lauderdale|orlando|tampa|jacksonville|charlotte|raleigh|durham|chapel hill|research triangle:America/New_York:us
richmond|norfolk|virginia beach|arlington va|mclean|reston|columbus|cleveland|cincinnati|buffalo|rochester|albany|hartford|providence|newark|jersey city|princeton|stamford:America/New_York:us
detroit|ann arbor|grand rapids:America/Detroit:us
indianapolis:America/Indiana/Indianapolis:us
chicago|milwaukee|minneapolis|st paul|saint paul|minneapolis-st paul|twin cities|st louis|saint louis|kansas city|omaha|des moines|madison:America/Chicago:us
dallas|fort worth|dallas-fort worth|dfw|houston|austin|san antonio|nashville|memphis|new orleans|oklahoma city|tulsa|birmingham al:America/Chicago:us
denver|boulder|colorado springs|salt lake city|albuquerque|santa fe:America/Denver:us
boise:America/Boise:us
phoenix|scottsdale|tempe|tucson:America/Phoenix:us
los angeles|san diego|irvine|orange county|santa monica|san francisco|sf|san francisco bay|bay area|sf bay area|silicon valley|san jose|oakland|palo alto|mountain view|sunnyvale|menlo park|sacramento:America/Los_Angeles:us
seattle|bellevue|redmond|tacoma|spokane|portland|las vegas|reno:America/Los_Angeles:us
anchorage:America/Anchorage:us
honolulu:Pacific/Honolulu:us
toronto|gta|mississauga|ottawa|waterloo|kitchener|hamilton|london on|montreal|quebec city:America/Toronto:ca
vancouver|victoria bc|burnaby|surrey|kelowna:America/Vancouver:ca
calgary|edmonton:America/Edmonton:ca
winnipeg:America/Winnipeg:ca
regina|saskatoon:America/Regina:ca
halifax:America/Halifax:ca
st johns:America/St_Johns:ca
sydney|canberra|newcastle nsw:Australia/Sydney:au
melbourne:Australia/Melbourne:au
brisbane|gold coast:Australia/Brisbane:au
perth:Australia/Perth:au
adelaide:Australia/Adelaide:au
hobart:Australia/Hobart:au
darwin:Australia/Darwin:au
sao paulo|rio de janeiro|belo horizonte|brasilia|curitiba|porto alegre|recife|salvador|fortaleza|florianopolis|campinas:America/Sao_Paulo:br
manaus:America/Manaus:br
mexico city|cdmx|ciudad de mexico|guadalajara|monterrey|puebla|queretaro:America/Mexico_City:mx
tijuana|mexicali:America/Tijuana:mx
cancun:America/Cancun:mx
hermosillo:America/Hermosillo:mx
moscow|moskva|saint petersburg|st petersburg|kazan|nizhny novgorod|rostov-on-don|sochi:Europe/Moscow:ru
kaliningrad:Europe/Kaliningrad:ru
samara:Europe/Samara:ru
yekaterinburg|ekaterinburg|perm|ufa|chelyabinsk:Asia/Yekaterinburg:ru
omsk:Asia/Omsk:ru
novosibirsk:Asia/Novosibirsk:ru
krasnoyarsk:Asia/Krasnoyarsk:ru
irkutsk:Asia/Irkutsk:ru
vladivostok|khabarovsk:Asia/Vladivostok:ru
jakarta|bandung|surabaya|medan|yogyakarta|semarang:Asia/Jakarta:id
denpasar|makassar|balikpapan:Asia/Makassar:id
jayapura:Asia/Jayapura:id
london|manchester|birmingham|edinburgh|glasgow|bristol|leeds|liverpool|cardiff|belfast|cambridge|oxford:Europe/London:gb
dublin|cork:Europe/Dublin:ie
paris|lyon|marseille|toulouse|nice:Europe/Paris:fr
berlin|munich|muenchen|hamburg|frankfurt|cologne|koln|stuttgart|dusseldorf:Europe/Berlin:de
amsterdam|rotterdam|the hague|utrecht|eindhoven|randstad:Europe/Amsterdam:nl
brussels|antwerp:Europe/Brussels:be
madrid|barcelona|valencia|seville:Europe/Madrid:es
lisbon|porto:Europe/Lisbon:pt
rome|milan|turin|naples|florence:Europe/Rome:it
zurich|geneva|basel|lausanne|bern:Europe/Zurich:ch
vienna:Europe/Vienna:at
stockholm|gothenburg:Europe/Stockholm:se
oslo:Europe/Oslo:no
copenhagen:Europe/Copenhagen:dk
helsinki:Europe/Helsinki:fi
warsaw|krakow|wroclaw|gdansk:Europe/Warsaw:pl
prague|brno:Europe/Prague:cz
budapest:Europe/Budapest:hu
bucharest|cluj-napoca:Europe/Bucharest:ro
athens:Europe/Athens:gr
istanbul|ankara:Europe/Istanbul:tr
kyiv|kiev|lviv:${KYIV_TZ}:ua
tallinn:Europe/Tallinn:ee
riga:Europe/Riga:lv
vilnius:Europe/Vilnius:lt
dubai|abu dhabi|sharjah:Asia/Dubai:ae
doha:Asia/Qatar:qa
riyadh|jeddah|dammam:Asia/Riyadh:sa
tel aviv|jerusalem|haifa:Asia/Jerusalem:il
cairo|alexandria:Africa/Cairo:eg
lagos|abuja:Africa/Lagos:ng
nairobi:Africa/Nairobi:ke
johannesburg|cape town|durban|pretoria:Africa/Johannesburg:za
casablanca:Africa/Casablanca:ma
accra:Africa/Accra:gh
karachi|lahore|islamabad:Asia/Karachi:pk
mumbai|bombay|navi mumbai|thane|delhi|new delhi|ncr|delhi ncr|bengaluru|bangalore|hyderabad|chennai|kolkata|pune|pimpri-chinchwad|gurugram|gurgaon|noida|ahmedabad|jaipur|kochi|chandigarh|indore|coimbatore|lucknow|trivandrum|thiruvananthapuram:Asia/Kolkata:in
dhaka:Asia/Dhaka:bd
colombo:Asia/Colombo:lk
kathmandu:Asia/Kathmandu:np
singapore:Asia/Singapore:sg
kuala lumpur|penang:Asia/Kuala_Lumpur:my
bangkok:Asia/Bangkok:th
ho chi minh city|saigon|hanoi:Asia/Ho_Chi_Minh:vn
manila|makati|cebu:Asia/Manila:ph
hong kong:Asia/Hong_Kong:hk
shanghai|beijing|shenzhen|guangzhou|hangzhou|chengdu:Asia/Shanghai:cn
taipei:Asia/Taipei:tw
seoul|busan:Asia/Seoul:kr
tokyo|osaka|yokohama|kyoto|nagoya:Asia/Tokyo:jp
auckland|wellington|christchurch:Pacific/Auckland:nz
chatham islands:Pacific/Chatham:nz
buenos aires:America/Argentina/Buenos_Aires:ar
santiago:America/Santiago:cl
easter island|rapa nui:Pacific/Easter:cl
bogota|medellin:America/Bogota:co
lima:America/Lima:pe
quito|guayaquil:America/Guayaquil:ec
galapagos|galapagos islands:Pacific/Galapagos:ec
kinshasa:Africa/Kinshasa:cd
lubumbashi:Africa/Lubumbashi:cd
nuuk:America/Nuuk:gl
qaanaaq|thule:America/Thule:gl
ulaanbaatar:Asia/Ulaanbaatar:mn
hovd:Asia/Hovd:mn
papeete|tahiti:Pacific/Tahiti:pf
marquesas islands:Pacific/Marquesas:pf
gambier islands:Pacific/Gambier:pf
port moresby:Pacific/Port_Moresby:pg
bougainville:Pacific/Bougainville:pg
ponta delgada|azores:Atlantic/Azores:pt
las palmas|santa cruz de tenerife|canary islands:Atlantic/Canary:es
`;

  // ---------- helpers ----------
  function norm(s) {
    return String(s)
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[’'`.]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function addAliases(map, aliases, value) {
    for (const a of aliases.split("|")) {
      const k = norm(a);
      if (!k) continue;
      (map[k] = map[k] || []).push(value);
    }
  }

  const COUNTRY = Object.create(null);   // key -> [{tz} | {cc}]
  COUNTRY_LINES.trim().split("\n").forEach((l) => {
    const i = l.lastIndexOf(":");
    addAliases(COUNTRY, l.slice(0, i), { tz: l.slice(i + 1).trim(), label: l.slice(0, l.indexOf("|") > -1 && l.indexOf("|") < i ? l.indexOf("|") : i) });
  });
  for (const cc in MULTI) addAliases(COUNTRY, MULTI[cc].names, { cc });

  const REGION = Object.create(null);
  const EXCEPT = Object.create(null);
  const CITY = Object.create(null);
  function loadCC(target, lines, cc) {
    (lines || "").trim().split("\n").filter(Boolean).forEach((l) => {
      const i = l.lastIndexOf(":");
      addAliases(target, l.slice(0, i), { tz: l.slice(i + 1).trim(), cc });
    });
  }
  for (const cc in REGION_LINES) loadCC(REGION, REGION_LINES[cc], cc);
  for (const cc in EXCEPTION_LINES) loadCC(EXCEPT, EXCEPTION_LINES[cc], cc);
  CITY_LINES.trim().split("\n").forEach((l) => {
    const [aliases, tz, cc] = l.split(":");
    addAliases(CITY, aliases, { tz: tz.trim(), cc: cc.trim() });
  });

  // Two-letter state codes are only trusted when we already know the country.
  const isShortCode = (k) => k.length <= 3 && !k.includes(" ");

  // "Greater Chicago Area" -> "chicago", "New York City Metropolitan Area" -> "new york city"
  function stripMetro(p) {
    return p
      .replace(/^(the )?greater /, "")
      .replace(/^city of /, "")
      .replace(/ (metropolitan|metro|capital|census|urban)? ?(area|region|metroplex)$/, "")
      .replace(/ metroplex$/, "")
      .replace(/ area$/, "")
      .trim();
  }

  function variants(p) {
    const out = [p];
    const s = stripMetro(p);
    if (s && s !== p) out.push(s);
    // "dallas-fort worth", "washington dc-baltimore", "pune/pimpri-chinchwad"
    for (const v of out.slice()) {
      if (/[-–\/&]| and /.test(v)) {
        v.split(/\s*[–\/&]\s*|\s+and\s+|-(?=[a-z]{3,})/).map((x) => x.trim()).filter(Boolean).forEach((x) => out.push(x));
      }
    }
    return [...new Set(out)];
  }

  function lookup(table, part, cc, allowShort) {
    for (const v of variants(part)) {
      if (!allowShort && isShortCode(v)) continue;
      const hits = table[v];
      if (!hits) continue;
      const hit = cc ? hits.find((h) => h.cc === cc) : hits[0];
      if (hit) return hit;
    }
    return null;
  }

  function passes(parts, cc) {
    for (const p of parts) { const h = lookup(EXCEPT, p, cc, false); if (h) return h; }
    for (const p of parts.slice().reverse()) { const h = lookup(REGION, p, cc, !!cc); if (h) return h; }
    for (const p of parts) { const h = lookup(CITY, p, cc, !!cc); if (h) return h; }
    return null;
  }

  function validTz(tz) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch (e) { return false; }
  }

  /**
   * resolve("Austin, Texas, United States") -> { tz: "America/Chicago" }
   * resolve("United States") -> { zones: ["America/New_York","America/Los_Angeles"], ambiguous: true, label }
   * returns null if unrecognised.
   */
  function resolve(raw) {
    if (!raw) return null;
    const trimmed = String(raw).trim();
    if (trimmed.length > 120) return null;
    if (trimmed.includes("/") && validTz(trimmed)) return { tz: trimmed };

    const parts = trimmed.split(/\s*[,·|]\s*/).map(norm).filter(Boolean);
    if (!parts.length || parts.join(" ").length > 120) return null;

    // A comma splits "Washington, DC" before the normal city/region passes.
    if (parts.length === 2 && parts[0] === "washington" && parts[1] === "dc") {
      return { tz: "America/New_York" };
    }

    // Country is normally the last part.
    const last = parts[parts.length - 1];
    let country = null, rest = parts;
    for (const v of variants(last)) {
      if (COUNTRY[v]) { country = COUNTRY[v][0]; rest = parts.slice(0, -1); break; }
    }
    // "Atlanta, Georgia" (US state, not the country)
    if (country && country.tz === "Asia/Tbilisi" && rest.length && lookup(CITY, rest[0], "us", false)) {
      country = { cc: "us" }; rest = parts;
    }

    if (country && country.tz) return { tz: country.tz };
    if (country && country.cc) {
      const hit = passes(rest, country.cc);
      if (hit) return { tz: hit.tz };
      const m = MULTI[country.cc];
      return m.def
        ? { tz: m.def, approximate: Boolean(m.approximate), label: m.label }
        : { zones: m.zones.slice(), ambiguous: true, label: m.label };
    }

    // Check the runtime rather than a fixed allow-list so aliases and newly
    // supported IANA names work. Country names take precedence (for example,
    // "Portugal" is also an old IANA alias but the country spans two zones).
    if (validTz(trimmed)) return { tz: trimmed };

    const hit = passes(parts, null);
    if (hit) return { tz: hit.tz };
    // A country sitting somewhere other than last ("India · Remote")
    for (const p of parts) {
      const c = COUNTRY[p] && COUNTRY[p][0];
      if (c && c.tz) return { tz: c.tz };
      if (c && c.cc) {
        const m = MULTI[c.cc];
        return m.def
          ? { tz: m.def, approximate: Boolean(m.approximate), label: m.label }
          : { zones: m.zones.slice(), ambiguous: true, label: m.label };
      }
    }
    return null;
  }

  const api = { resolve, validTz, _norm: norm, _tables: { COUNTRY, REGION, EXCEPT, CITY } };
  global.LTResolver = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
