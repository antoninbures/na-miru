import axios from 'axios';
import fs from 'fs';
import slugify from 'slugify';
import dotenv from 'dotenv';

dotenv.config();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY_REVIEWS;
const WEBFLOW_API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const WEBFLOW_COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID;

const PLACE_ID = 'ChIJiSPKJ1bxCkcRz6wptMDp4Uo';

// ✅ Validace environment variables
function validateEnvVars() {
  const required = ['GOOGLE_API_KEY_REVIEWS', 'WEBFLOW_API_TOKEN', 'WEBFLOW_COLLECTION_ID'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error(`❌ Chybějící environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// ✅ Načtení recenzí z Google
async function fetchGoogleReviews() {
  try {
    console.log('🔍 Stahování recenzí z Google Places API...');
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${PLACE_ID}&key=${GOOGLE_API_KEY}&language=cs&reviews_sort=newest`;

    const response = await axios.get(url);

    if (response.data.status !== 'OK') {
      throw new Error(`Google API error: ${response.data.status} - ${response.data.error_message || 'Unknown error'}`);
    }

    const place = response.data.result;

    if (!place) {
      throw new Error('Místo nebylo nalezeno');
    }

    return {
      placeUrl: place.url || '',
      reviews: place.reviews || []
    };
  } catch (error) {
    console.error('❌ Chyba při stahování Google recenzí:', error.message);
    throw error;
  }
}

// ✅ Načtení existujících recenzí z Webflow (kvůli deduplikaci)
async function fetchExistingReviewIds() {
  console.log('📥 Načítám existující položky z Webflow kvůli deduplikaci...');
  const existingIds = new Set();

  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}/items?offset=${offset}&limit=${limit}`;
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
        Accept: 'application/json'
      }
    });

    const items = res.data.items || [];

    for (const item of items) {
      const fieldData = item.fieldData || {};
      if (fieldData.reviewid) {
        existingIds.add(fieldData.reviewid.toString());
      }
    }

    if (items.length < limit) break; // žádná další stránka
    offset += limit;
  }

  console.log(`💾 Ve Webflow je aktuálně ${existingIds.size} recenzí (podle reviewid).`);
  return existingIds;
}

function toSlug(name, id) {
  const cleanName = name.replace(/[^\w\s-]/g, '').trim();
  return slugify(`${cleanName}-${id}`, { lower: true, strict: true });
}

// ✅ Připravení payloadu pro Webflow
function buildItemPayload(review, placeUrl) {
  if (!review.author_name || !review.rating || !review.time) {
    throw new Error('Neplatná data recenze');
  }

  const reviewText = review.text ? review.text.replace(/<[^>]*>/g, '') : '';

  return {
    isArchived: false,
    isDraft: false,
    fieldData: {
      name: review.author_name.substring(0, 256),
      slug: toSlug(review.author_name, review.time).substring(0, 256),
      rating: Math.min(Math.max(review.rating, 1), 5),
      text: reviewText ? `<p>${reviewText}</p>` : '<p>Bez komentáře</p>',
      date: new Date(review.time * 1000).toISOString(),
      source: 'Google',
      avatar: review.profile_photo_url || '',
      reviewurl: placeUrl,
      reviewid: review.time.toString(),
    }
  };
}

// ✅ Odeslání do Webflow – rovnou LIVE
async function sendToWebflow(item) {
  try {
    // 🔴 změna: používáme /items/live (ne /items?live=true)
    const url = `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}/items/live`;

    const response = await axios.post(url, item, {
      headers: {
        Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      timeout: 30000
    });

    console.log(`   ✅ Úspěšně nahráno - itemId: ${response.data.id}`);
    return response.data;
  } catch (error) {
    let errorMessage = 'Neznámá chyba';

    if (error.response) {
      errorMessage = `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`;
    } else if (error.request) {
      errorMessage = 'Žádná odpověď od serveru';
    } else {
      errorMessage = error.message;
    }

    console.error(`   ❌ Webflow error: ${errorMessage}`);
    throw error;
  }
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  try {
    console.log('🚀 Spouštím synchronizaci recenzí...');

    validateEnvVars();

    // 1) stáhnout Google recenze
    const { placeUrl, reviews } = await fetchGoogleReviews();

    // 2) stáhnout existující reviewid z Webflow
    const existingIds = await fetchExistingReviewIds();

    // 3) filtrovat jen nové (podle review.time / reviewid)
    const newOnes = reviews.filter(r => !existingIds.has(r.time.toString()));

    console.log(`\n📊 Statistiky:`);
    console.log(`   📈 Celkem recenzí z Google: ${reviews.length}`);
    console.log(`   🆕 Nových recenzí k nahrání: ${newOnes.length}`);
    console.log(`   💾 Ve Webflow už je: ${existingIds.size}`);

    if (newOnes.length === 0) {
      console.log('✅ Žádné nové recenze k nahrání');
      return;
    }

    console.log(`\n🆕 Přehled nových recenzí:`);
    newOnes.forEach(r => {
      console.log(`   • ${r.author_name} (${r.rating}★) – ${new Date(r.time * 1000).toLocaleDateString('cs-CZ')}`);
    });

    // 4) nahrání do Webflow
    console.log('\n📤 Nahrávání do Webflow...');
    let successCount = 0;

    for (const [index, review] of newOnes.entries()) {
      try {
        console.log(`📤 [${index + 1}/${newOnes.length}] Nahrávám: ${review.author_name}`);
        const item = buildItemPayload(review, placeUrl);
        await sendToWebflow(item);
        successCount++;

        if (index < newOnes.length - 1) {
          await delay(1000);
        }
      } catch (error) {
        console.error(`❌ Chyba při nahrávání recenze ${review.author_name}:`, error.message);
      }
    }

    console.log(`\n✅ Úspěšně nahráno ${successCount} nových recenzí`);
    console.log('🎉 Synchronizace dokončena!');
  } catch (error) {
    console.error('❌ Kritická chyba:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

main();
