/**
 * Inserts sample employees if fewer than 2 exist (minimum for roster generation).
 * Run from backend folder: npm run seed
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const path = require("path");
const connectDB = require(path.join(__dirname, "..", "db"));
const Employee = require(path.join(__dirname, "..", "models", "Employee"));

const NAMES = [
  "Saumil",
  "Komal",
  "Balaji",
  "Mari",
  "Venkatesh",
  "Ram",
  "Parshuram",
  "Ramya",
  "Shubham"
];

async function main() {
  await connectDB();
  const before = await Employee.countDocuments();
  if (before >= 2) {
    console.log(`Already ${before} employees — nothing to do.`);
    process.exit(0);
  }

  let added = 0;
  for (const name of NAMES) {
    try {
      await Employee.create({ name, compOff: 0 });
      console.log("Added:", name);
      added++;
    } catch (e) {
      if (e.code === 11000) {
        console.log("Skip (exists):", name);
      } else {
        throw e;
      }
    }
  }

  const after = await Employee.countDocuments();
  console.log(`Done. Employees: ${before} → ${after} (+${added})`);
  process.exit(0);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
