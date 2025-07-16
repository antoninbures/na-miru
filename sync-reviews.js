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
  return {
    reviews: data.result?.reviews || [],
    placeUrl: data.result?.url || '',
  };
}

async function loadKnownReviewIds() {
  try {
    const raw = fs.readFileSync(KNOWN_REVIEWS_PATH, 'utf8');
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

async function saveKnownReviewIds(ids) {
  fs.writeFileSync(KNOWN_REVIEWS_PATH, JSON.stringify([...ids], null, 2), 'utf8');
}

async function uploadToWebflow(review, placeUrl) {
  const slug = slugify(`${review.author_name}-${review.time}`);
  const response = await axios.post(
    `https://api.webflow.com/collections/${WEBFLOW_COLLECTION_ID}/items?live=true`,
    {
      fields: {
        name: review.author_name,
        slug: slug,
        rating: review.rating,
        text: review.text || '',
        date: new Date(review.time * 1000).toISOString(),
        source: 'Google',
        avatar: review.profile_photo_url,
        reviewUrl: placeUrl,
        reviewId: review.time.toString(),
        _archived: false,
        _draft: false,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
        'Content-Type': 'application/json',
        'accept-version': '1.0.0',
      },
    }
  );

  return response.data;
}

(async () => {
  const { reviews, placeUrl } = await fetchGoogleReviews();
  const knownIds = await loadKnownReviewIds();

  const newReviews = reviews.filter(r => !knownIds.has(r.time.toString()));
  if (newReviews.length === 0) {
    console.log('📭 No new reviews to upload.');
    return;
  }

  for (const review of newReviews) {
    try {
      await uploadToWebflow(review, placeUrl);
      knownIds.add(review.time.toString());
      console.log(`✅ Uploaded review by ${review.author_name}`);
    } catch (err) {
      console.error(`❌ Failed to upload review by ${review.author_name}: ${err.message}`);
    }
  }

  await saveKnownReviewIds(knownIds);
})();
