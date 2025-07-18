import { config } from "dotenv";
import { writeFileSync } from "fs";

config();

const placeId = "ChIJiSPKJ1bxCkcRz6wptMDp4Uo"; 
const apiKey = process.env.GOOGLE_API_KEY;

const url = `https://places.googleapis.com/v1/places/${placeId}?fields=rating,userRatingCount`;

async function fetchRating() {
  try {
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "rating,userRatingCount",
        "Referer": "https://github.com"
      }
    });

    const text = await response.text();

    try {
      const data = JSON.parse(text);
      console.log("📦 Odpověď z API:", JSON.stringify(data, null, 2));

      // Zkontrolovat chyby API
      if (data.error) {
        throw new Error(`❌ Google API chyba: ${data.error.message} (${data.error.code})`);
      }

      if (!data.rating || !data.userRatingCount) {
        throw new Error("❌ API nevrátilo hodnocení nebo počet recenzí.");
      }

      const result = {
        rating: data.rating,
        total: data.userRatingCount,
        updated: new Date().toISOString()
      };

      writeFileSync("data.json", JSON.stringify(result, null, 2));
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