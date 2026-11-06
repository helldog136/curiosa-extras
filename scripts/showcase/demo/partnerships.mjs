// Partnerships: a small invented pipeline.
export default async function (h) {
  for (const [brand, status, chances, sector, country] of [["Pixel Harbor", "discussion", 60, "Games", "BE"], ["Echo Garden", "envoye", 40, "Tea and drinks", "FR"], ["Stellar Drift", "accepte", 90, "Games", "CA"], ["Moss and Lantern", "a_contacter", 20, "Cozy games", "BE"], ["Tiny Rails", "publie", 100, "Games", "NL"]])
    await h.act("partnerships", "savePartner", { brand, status, chances: String(chances), url: `https://example.org/${brand.toLowerCase().replace(/\W+/g, "-")}`, sector, country }).catch((e) => console.log("  savePartner", String(e.message).slice(0, 100)));
}
