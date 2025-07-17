// sync-reviews.js
import axios from 'axios';
import fs from 'fs';
import slugify from 'slugify';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const WEBFLOW_API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const WEBFLOW_COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID;

const PLACE_ID = 'ChIJiSPKJ1bxCkcRz6wptMDp4Uo';
const CACHE_FILE = './.review-cache.json';

async function fetchGoogleReviews() {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${PLACE_ID}&key=${GOOGLE_API_KEY}&language=cs&reviews_sort=newest`;
  const response = await axios.get(url);
  const place = response.data.result;
  return {
    placeUrl: place.url,
    reviews: place.reviews || []
  };
}

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE));
  } catch {
    return { reviewIds: [] };
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function toSlug(name, id) {
  return slugify(`${name}-${id}`, { lower: true, strict: true });
}

function buildItemPayload(review, placeUrl) {
  return {
    isArchived: false,
    isDraft: false,
    fieldData: {
      name: review.author_name,
      slug: toSlug(review.author_name, review.time),
      rating: review.rating,
      text: `<p>${review.text}</p>`,
      date: new Date(review.time * 1000).toISOString(),
      source: 'Google',
      avatar: review.profile_photo_url || '',
      reviewUrl: placeUrl,
      reviewId: review.time.toString(),
    }
  };
}

async function sendToWebflow(item) {
  try {
    const url = `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}/items?live=true`;
    const res = await axios.post(url, item, {
      headers: {
        Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      }
    });
    console.log(`   ✅ itemId ${res.data.id}`);
  } catch (err) {
    const w = err?.response?.data || err?.message || err;
    console.error('   ❌ Webflow error:', w);
  }
}

(async () => {
  try {
    const { placeUrl, reviews } = await fetchGoogleReviews();
    const cache = loadCache();
    const newOnes = reviews.filter(r => !cache.reviewIds.includes(r.time.toString()));

    console.log(`\n🔎 Staženo ${reviews.length} recenzí z Google`);
    console.log(`🆕 Přehled nových recenzí:`);
    newOnes.forEach(r => console.log(` • ${r.author_name} (${r.rating}★) – ${r.time}`));

    for (const review of newOnes) {
      console.log(`📤 Nahrávám: ${review.author_name}`);
      const item = buildItemPayload(review, placeUrl);
      await sendToWebflow(item);
    }

    cache.reviewIds.push(...newOnes.map(r => r.time.toString()));
    saveCache(cache);
    console.log('💾 Cache aktualizována.');
  } catch (err) {
    console.error('❌ Neočekávaná chyba:', err.message);
    process.exit(1);
  }
})();
