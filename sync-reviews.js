// sync-reviews.js
// ----------------
const axios   = require('axios');
const slugify = require('slugify');
const fs      = require('fs');
require('dotenv').config();

// ----- konfigurace -------------------------------------------------
const PLACE_ID            = 'ChIJiSPKJ1bxCkcRz6wptMDp4Uo';      // Google Place ID
const REVIEW_CACHE_PATH   = './data/reviewCache.json';           // uložení ID již nahraných recenzí

const {
  GOOGLE_API_KEY,
  WEBFLOW_API_TOKEN,
  WEBFLOW_COLLECTION_ID,
} = process.env;

if (!GOOGLE_API_KEY || !WEBFLOW_API_TOKEN || !WEBFLOW_COLLECTION_ID) {
  console.error('❌ Chybí environment proměnné!');
  process.exit(1);
}
// -------------------------------------------------------------------

/* ------------------------------------------------------------------ *
 * 1) Načti schéma kolekce a vytvoř mapu slug → id                    *
 * ------------------------------------------------------------------ */
async function getFieldIdMap() {
  const res = await axios.get(
    `https://api.webflow.com/collections/${WEBFLOW_COLLECTION_ID}`,
    {
      headers: {
        Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
        'accept-version': '2.0.0',
      },
    }
  );
  return Object.fromEntries(res.data.fields.map(f => [f.slug, f._id]));
}

/* ------------------------------------------------------------------ *
 * 2) Stáhni recenze z Google                                         *
 * ------------------------------------------------------------------ */
async function fetchReviews() {
  const url =
    `https://maps.googleapis.com/maps/api/place/details/json` +
    `?place_id=${PLACE_ID}` +
    `&fields=reviews,url` +
    `&language=cs` +
    `&key=${GOOGLE_API_KEY}`;

  const res = await axios.get(url);
  if (res.data.status !== 'OK' || !res.data.result.reviews) {
    throw new Error(`Google API error: ${JSON.stringify(res.data)}`);
  }
  return {
    reviews: res.data.result.reviews,
    placeUrl: res.data.result.url,
  };
}

/* ------------------------------------------------------------------ *
 * 3) Připrav payload podle ID mapy                                   *
 * ------------------------------------------------------------------ */
function buildPayload(review, placeUrl, field) {
  const slug = slugify(`${review.author_name}-${review.time}`, {
    lower: true,
    strict: true,
  });

  return {
    name: review.author_name,  // systémové pole položky
    slug: slug,                // systémové slug položky
    fields: {
      [field.rating]   : review.rating,
      [field.text]     : `<p>${review.text}</p>`,
      [field.date]     : new Date(review.time * 1000).toISOString(),
      [field.source]   : 'Google',
      [field.avatar]   : review.profile_photo_url || '',
      [field.reviewUrl]: placeUrl,
      [field.reviewId] : review.time.toString(),
      _archived : false,
      _draft    : false,
    },
  };
}

/* ------------------------------------------------------------------ *
 * 4) Hlavní flow                                                     *
 * ------------------------------------------------------------------ */
(async () => {
  try {
    // a) mapa slug → id
    const FIELD = await getFieldIdMap();

    // b) recenze z Google
    const { reviews, placeUrl } = await fetchReviews();
    console.log(`🔎 Staženo ${reviews.length} recenzí z Google`);

    // c) načti / připrav cache
    let cache = [];
    if (fs.existsSync(REVIEW_CACHE_PATH)) {
      try {
        cache = JSON.parse(fs.readFileSync(REVIEW_CACHE_PATH, 'utf-8'));
      } catch {
        console.warn('⚠️  Cache se nepodařilo načíst, pokračuji bez ní');
      }
    }
    const cachedIds = new Set(cache.map(r => r.reviewId));

    // d) odfiltruj nové
    const newReviews = reviews.filter(r => !cachedIds.has(r.time.toString()));
    if (newReviews.length === 0) {
      console.log('📭 Žádné nové recenze k odeslání.');
      return;
    }

    console.log('🆕 Přehled nových recenzí:');
    newReviews.forEach(r =>
      console.log(` • ${r.author_name} (${r.rating}★) – ${r.time}`)
    );

    // e) odesílání do Webflow
    for (const review of newReviews) {
      const payload = buildPayload(review, placeUrl, FIELD);
      console.log(`📤 Nahrávám: ${payload.name}`);

      try {
        const res = await axios.post(
          `https://api.webflow.com/collections/${WEBFLOW_COLLECTION_ID}/items?live=true`,
          payload,
          {
            headers: {
              Authorization   : `Bearer ${WEBFLOW_API_TOKEN}`,
              'Content-Type'  : 'application/json',
              'accept-version': '2.0.0',
            },
          }
        );
        console.log(`   ✅ OK – itemId ${res.data._id}`);
        cache.push({ reviewId: review.time.toString() });
      } catch (err) {
        console.error('   ❌ Webflow error:', err.response?.data || err.message);
      }
    }

    // f) aktualizuj cache
    fs.writeFileSync(REVIEW_CACHE_PATH, JSON.stringify(cache, null, 2));
    console.log('💾 Cache aktualizována.');
  } catch (err) {
    console.error('❌ Neočekávaná chyba:', err.message);
    process.exit(1);
  }
})();
