const axios = require('axios');
const slugify = require('slugify');
const fs = require('fs');
require('dotenv').config();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const WEBFLOW_API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const WEBFLOW_COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID;
const PLACE_ID = 'ChIJiSPKJ1bxCkcRz6wptMDp4Uo';
const REVIEW_CACHE_PATH = './data/reviewCache.json';

(async () => {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${PLACE_ID}&fields=reviews,url&language=cs&key=${GOOGLE_API_KEY}`;
    const res = await axios.get(url);

    if (res.data.status !== 'OK' || !res.data.result.reviews) {
      console.error('❌ Chyba při načítání recenzí z Google API:', res.data);
      return;
    }

    const reviews = res.data.result.reviews;
    const placeUrl = res.data.result.url;
    console.log(`🔎 Staženo ${reviews.length} recenzí z Google`);

    // Načtení cache
    let cache = [];
    if (fs.existsSync(REVIEW_CACHE_PATH)) {
      try {
        cache = JSON.parse(fs.readFileSync(REVIEW_CACHE_PATH, 'utf-8'));
      } catch {
        console.warn('⚠️ Nepodařilo se načíst cache, pokračuji bez ní');
      }
    }

    const cachedIds = new Set(cache.map((r) => r.reviewId));
    const newReviews = reviews.filter((r) => !cachedIds.has(r.time.toString()));

    if (newReviews.length === 0) {
      console.log('📭 Žádné nové recenze k odeslání.');
      return;
    }

    console.log(`🆕 Přehled recenzí:`);
    newReviews.forEach((r) =>
      console.log(` - ${r.time}: ${r.author_name} (${r.rating}★)`)
    );

    for (const review of newReviews) {
      const slug = slugify(`${review.author_name}-${review.time}`, {
        lower: true,
        strict: true,
      });

      const payload = {
        name: review.author_name,
        slug: slug,
        fields: {
          name: review.author_name,
          slug: slug,
          rating: review.rating,
          text: `<p>${review.text}</p>`,
          avatar: review.profile_photo_url || '',
          reviewUrl: placeUrl,
          date: new Date(review.time * 1000).toISOString(),
          source: 'Google',
          reviewId: review.time.toString(),
          _archived: false,
          _draft: false,
        },
      };

      console.log(`📤 Odesílám recenzi: ${review.author_name} (${slug})`);
      console.log(JSON.stringify(payload, null, 2));

      try {
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
        cache.push({ reviewId: review.time.toString() });
      } catch (err) {
        console.error('❌ Chyba při nahrávání do Webflow:', {
          msg: err.response?.data?.msg || err.message,
          status: err.response?.status,
          data: err.response?.data,
          sentPayload: payload,
        });
      }
    }

    fs.writeFileSync(REVIEW_CACHE_PATH, JSON.stringify(cache, null, 2));
    console.log('💾 Cache aktualizována.');
  } catch (err) {
    console.error('❌ Neočekávaná chyba:', err);
  }
})();
