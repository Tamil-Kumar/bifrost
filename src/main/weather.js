'use strict';
// Weather for the start page's weather module, from Open-Meteo (free, no account or key). Requests go
// through a separate in-memory session, so no cookies are sent. Places are looked up once and kept;
// forecasts are kept for 15 minutes.
const { app, session } = require('electron');
const ctx = require('./context');

const FORECAST_MS = 15 * 60e3;
const cache = new Map();   // "lat,lon,units" -> { at, data }

function fetchSession() {
  const ses = session.fromPartition('bifrost-icons');
  return ses;
}

async function getJson(url) {
  let res;
  try {
    res = await fetchSession().fetch(url, { signal: AbortSignal.timeout(10000), headers: { accept: 'application/json' } });
  } catch {
    throw new Error('Couldn’t reach the weather service. Check your connection.');
  }
  if (!res.ok) throw new Error('The weather service answered ' + res.status);
  return res.json();
}

// Fahrenheit where people use it.
function autoUnits() {
  try { return ['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW'].includes(app.getLocaleCountryCode()) ? 'f' : 'c'; } catch { return 'c'; }
}

async function place(city) {
  const key = 'weather.place.' + city.trim().toLowerCase();
  const known = ctx.db.kvGet(key, null);
  if (known) return known;
  const j = await getJson('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' + encodeURIComponent(city.trim()));
  const r = j && j.results && j.results[0];
  if (!r) throw new Error(`No place called “${city}” was found`);
  const p = { name: r.name, region: r.admin1 || '', country: r.country_code || r.country || '', lat: r.latitude, lon: r.longitude };
  ctx.db.kvSet(key, p);
  return p;
}

async function forecast(city, units) {
  if (!city || !String(city).trim()) throw new Error('Choose a city for the weather');
  const u = units === 'f' || units === 'c' ? units : autoUnits();
  const p = await place(String(city));
  const key = `${p.lat},${p.lon},${u}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < FORECAST_MS) return hit.data;
  const q = new URLSearchParams({
    latitude: String(p.lat), longitude: String(p.lon), timezone: 'auto', forecast_days: '4',
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    temperature_unit: u === 'f' ? 'fahrenheit' : 'celsius', wind_speed_unit: u === 'f' ? 'mph' : 'kmh',
  });
  const j = await getJson('https://api.open-meteo.com/v1/forecast?' + q);
  const c = j.current || {};
  const d = j.daily || {};
  const data = {
    place: p, units: u,
    now: { temp: c.temperature_2m, feels: c.apparent_temperature, code: c.weather_code, day: c.is_day !== 0, wind: c.wind_speed_10m, humidity: c.relative_humidity_2m },
    days: (d.time || []).map((t, i) => ({ date: t, code: d.weather_code[i], hi: d.temperature_2m_max[i], lo: d.temperature_2m_min[i], rain: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null })),
    at: Date.now(),
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}

module.exports = { forecast, autoUnits };
