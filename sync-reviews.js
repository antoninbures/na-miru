
require('dotenv').config();
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const PLACE_ID = 'ChIJiSPKJ1bxCkcRz6wptMDp4Uo';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const WEBFLOW_API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const WEBFLOW_COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID;
const KNOWN_REVIEWS_PATH = path.join(__dirname, 'data', 'known-reviews.json');

const slugify = (text) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').substring(0, 60);

async function fetchGoogleReviews() {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${PLACE_ID}&fields=reviews,url&key=${GOOGLE_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!data.result || !data.result.reviews) {
    console.log("❌ Chyba při načítání recenzí z Google API:", data);
    return { reviews: [], placeUrl: '' };
  }

  return {
    reviews: data.result.reviews,
    placeUrl: data.result.url || '',
  };
}

async function uploadToWebflow(review, placeUrl) {
  const slug = slugify(`${review.author_name}-${review.time}`);
  const payload = {
  fields: {
    name: review.author_name,
    slug: slug,
    rating: review.rating,
    text: `<p>${review.text || ''}</p>`,
    date: new Date(review.time * 1000).toISOString(),
    source: 'Google',
    reviewUrl: placeUrl,
    reviewId: review.time.toString(),
    _archived: false,
    _draft: false,
  },
};

  console.log(`📤 Odesílám recenzi: ${review.author_name} (${slug})`);
  console.log(JSON.stringify(payload, null, 2));

  const response = await axios.post(
    `https://api.webflow.com/collections/${WEBFLOW_COLLECTION_ID}/items?live=true`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
        'Content-Type': 'application/json',
        'accept-version': '1.0.0',
      },
    }
  );

  console.log(`✅ Webflow odpověď:`, response.data);
  return response.data;
}

(async () => {
  const { reviews, placeUrl } = await fetchGoogleReviews();

  console.log(`🔎 Staženo ${reviews.length} recenzí z Google`);
  if (reviews.length === 0) {
    console.log('📭 Žádné recenze nebyly nalezeny.');
    return;
  }

  console.log('🆕 Přehled recenzí:');
  reviews.forEach((r) =>
    console.log(` - ${r.time}: ${r.author_name} (${r.rating}★)`)
  );

  const first = reviews[0];
  if (!first) {
    console.log('⚠️ Žádná první recenze – něco je špatně.');
    return;
  }

  try {
    await uploadToWebflow(first, placeUrl);
    console.log('✅ Testovací nahrání hotovo.');
  } catch (err) {
    console.error('❌ Chyba při nahrávání do Webflow:', err.response?.data || err.message);
  }
})();
