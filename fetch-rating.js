require("dotenv").config();
const fs = require("fs");

const placeId = "ChIJiSPKJ1bxCkcRz6wptMDp4Uo"; // ← pozor: musí být ve formátu "places/..."
const apiKey = process.env.GOOGLE_API_KEY;

const url = `https://places.googleapis.com/v1/${placeId}?fields=rating,userRatingCount&key=${apiKey}`;

async function fetchRating() {
  try {
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey
      }
    });

    const data = await response.json();
    console.log("📦 Odpověď z API:", JSON.stringify(data, null, 2));

    if (!data.rating || !data.userRatingCount) {
      throw new Error("❌ API nevrátilo hodnocení nebo počet recenzí.");
    }

    const result = {
      rating: data.rating,
      total: data.userRatingCount,
      updated: new Date().toISOString()
    };

    fs.writeFileSync("data.json", JSON.stringify(result, null, 2));
    console.log("✅ Hodnocení uloženo do data.json");
  } catch (err) {
    console.error("❌ Chyba při načítání dat:", err.message);
    process.exit(1);
  }
}

fetchRating();

