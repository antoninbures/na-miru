/**
 * sync-reviews.js  –  Google Reviews ➜ Webflow CMS (v2 API)
 * --------------------------------------------------------
 * ➊ načte schéma kolekce a vytvoří mapu slug → fieldId
 * ➋ stáhne recenze z Google Places (cs)
 * ➌ odešle jen nové recenze do Webflow (fieldData formát)
 * --------------------------------------------------------
 * ENV vars (GitHub Actions secrets):
 *   GOOGLE_API_KEY
 *   WEBFLOW_API_TOKEN
 *   WEBFLOW_COLLECTION_ID
 */

const axios   = require('axios');
const slugify = require('slugify');
const fs      = require('fs');
require('dotenv').config();

// ---------- konfigurace -------------------------------------------
const PLACE_ID          = 'ChIJiSPKJ1bxCkcRz6wptMDp4Uo';
const REVIEW_CACHE_PATH = './data/reviewCache.json';

const {
  GOOGLE_API_KEY,
  WEBFLOW_API_TOKEN,
  WEBFLOW_COLLECTION_ID,
} = process.env;

if (!GOOGLE_API_KEY || !WEBFLOW_API_TOKEN || !WEBFLOW_COLLECTION_ID) {
  console.error('❌ Chybí environment proměnné');
  process.exit(1);
}
// ------------------------------------------------------------------

/** -----------------------------------------------------------------
 * 1) vrátí mapu { slug : fieldId }
 * ----------------------------------------------------------------*/
async function getFieldMap() {
  const res = await axios.get(
    `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}`,
    { headers: { Authorization: `Bearer ${WEBFLOW_API_TOKEN}` } }
  );
  return Object.fromEntries(res.data.fields.map(f => [f.slug, f._id]));
}

/** -----------------------------------------------------------------
 * 2) stáhne recenze z Google
 * ----------------------------------------------------------------*/
async function fetchReviews() {
  const url =
    'https://maps.googleapis.com/maps/api/place/details/json' +
    `?place_id=${PLACE_ID}` +
    '&fields=reviews,url' +
    '&language=cs' +
    `&key=${GOOGLE_API_KEY}`;

  const res = await axios.get(url);
  if (res.data.status !== 'OK' || !res.data.result.reviews)
    throw new Error(`Google API error: ${JSON.stringify(res.data)}`);

  return { reviews: res.data.result.reviews, placeUrl: res.data.result.url };
}

/** -----------------------------------------------------------------
 * 3) vytvoří payload pro Webflow v2 (fieldData)
 * ----------------------------------------------------------------*/
function toPayload(r, placeUrl, F) {
  const slug = slugify(`${r.author_name}-${r.time}`, { lower: true, strict: true });

  return {
    isArchived: false,
    isDraft:    false,
    fieldData: {
      name : r.author_name,
      slug : slug,

      [F.rating]   : r.rating,
      [F.text]     : `<p>${r.text}</p>`,
      [F.date]     : new Date(r.time * 1000).toISOString(),
      [F.source]   : 'Google',
      [F.avatar]   : r.profile_photo_url || '',
      [F.reviewUrl]: placeUrl,
      [F.reviewId] : r.time.toString(),
    },
  };
}

/* =================================================================
 *  MAIN
 * =================================================================*/
(async () => {
  try {
    /* a) schéma kolekce ------------------------------------------------*/
    const F = await getFieldMap();

    /* b) recenze z Google --------------------------------------------*/
    const { reviews, placeUrl } = await fetchReviews();
    console.log(`🔎 Staženo ${reviews.length} recenzí z Google`);

    /* c) cache --------------------------------------------------------*/
    let cache = [];
    if (fs.existsSync(REVIEW_CACHE_PATH)) {
      try   { cache = JSON.parse(fs.readFileSync(REVIEW_CACHE_PATH, 'utf-8')); }
      catch { console.warn('⚠️ Cache nečitelná, pokračuji bez ní'); }
    }
    const cachedIds = new Set(cache.map(r => r.reviewId));

    const newReviews = reviews.filter(r => !cachedIds.has(r.time.toString()));
    if (!newReviews.length) {
      console.log('📭 Žádné nové recenze.');
      return;
    }

    console.log('🆕 Přehled nových recenzí:');
    newReviews.forEach(r => console.log(` • ${r.author_name} (${r.rating}★) – ${r.time}`));

    /* d) odesílání ----------------------------------------------------*/
    for (const r of newReviews) {
      const payload = toPayload(r, placeUrl, F);
      console.log(`📤 Nahrávám: ${r.author_name}`);

      try {
        const res = await axios.post(
          `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}/items?live=true`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
              'Content-Type': 'application/json',
            },
          }
        );
        console.log(`   ✅ itemId ${res.data.itemId}`);
        cache.push({ reviewId: r.time.toString() });
      } catch (err) {
        console.error('   ❌ Webflow error:', err.response?.data || err.message);
      }
    }

    /* e) update cache -------------------------------------------------*/
    fs.mkdirSync('data', { recursive: true });
    fs.writeFileSync(REVIEW_CACHE_PATH, JSON.stringify(cache, null, 2));
    console.log('💾 Cache aktualizována.');
  } catch (err) {
    console.error(`❌ Neočekávaná chyba: ${err.message}`);
    process.exit(1);
  }
})();
