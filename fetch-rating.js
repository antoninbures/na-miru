require("dotenv").config();
const fs = require("fs");

const placeId = "ChIJiSPKJ1bxCkcRz6wptMDp4Uo"; // ← nahraď svým skutečným Place ID
const apiKey = process.env.GOOGLE_API_KEY;

const url = `https://places.googleapis.com/v1/${placeId}?fields=rating,userRatingCount`;

async function fetchRating() {
  try {
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey
      }
    });

    const text = await response.text();

    try {
      const data = JSON.parse(text);
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
    } catch (jsonErr) {
      console.error("❌ Odpověď není validní JSON:");
      console.error(text);
      throw jsonErr;
    }
  } catch (err) {
    console.error("❌ Chyba při načítání dat:", err.message);
    process.exit(1);
  }
}

fetchRating();
