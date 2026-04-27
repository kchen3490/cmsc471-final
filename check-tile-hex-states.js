const fs = require("fs");
const path = require("path");

const gamesDir = path.join(__dirname, "data", "games");
const outputDir = path.join(__dirname, "data");

function hasRequiredTileEntries(tileHexStates) {
  if (!tileHexStates || typeof tileHexStates !== "object") {
    return false;
  }

  const keys = Object.keys(tileHexStates);
  if (keys.length !== 19) {
    return false;
  }

  for (let i = 0; i <= 18; i += 1) {
    const key = String(i);
    if (!Object.prototype.hasOwnProperty.call(tileHexStates, key)) {
      return false;
    }
  }

  return true;
}

function validateGameFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const tileHexStates =
      parsed?.data?.eventHistory?.initialState?.mapState?.tileHexStates;
    const victoryPointsToWin = parsed?.data?.gameSettings?.victoryPointsToWin;
    const cardDiscardLimit = parsed?.data?.gameSettings?.cardDiscardLimit;
    const mapSetting = parsed?.data?.gameSettings?.mapSetting;
    const modeSetting = parsed?.data?.gameSettings?.modeSetting;

    if (!hasRequiredTileEntries(tileHexStates)) {
      return {
        valid: false,
        reason:
          "tileHexStates must contain exactly keys 0-18 (no missing or extra keys)",
      };
    }

    if (victoryPointsToWin !== 10) {
      return {
        valid: false,
        reason: `victoryPointsToWin is ${victoryPointsToWin}, expected 10`,
      };
    }

    if (cardDiscardLimit !== 7) {
      return {
        valid: false,
        reason: `cardDiscardLimit is ${cardDiscardLimit}, expected 7`,
      };
    }

    if (mapSetting !== 0) {
      return {
        valid: false,
        reason: `mapSetting is ${mapSetting}, expected 0`,
      };
    }

    if (modeSetting !== 0) {
      return {
        valid: false,
        reason: `modeSetting is ${modeSetting}, expected 0`,
      };
    }

    return {
      valid: true,
      reason: null,
    };
  } catch (error) {
    return {
      valid: false,
      reason: `Unreadable JSON (${error.message})`,
    };
  }
}

function main() {
  if (!fs.existsSync(gamesDir)) {
    console.error(`Directory not found: ${gamesDir}`);
    process.exit(1);
  }

  const allFiles = fs
    .readdirSync(gamesDir)
    .filter((name) => name.toLowerCase().endsWith(".json"));

  const validFiles = [];
  const invalidFiles = [];

  for (let i = 0; i < allFiles.length; i += 1) {
    const fileName = allFiles[i];
    const fullPath = path.join(gamesDir, fileName);
    const result = validateGameFile(fullPath);

    if (result.valid) {
      validFiles.push(fileName);
    } else {
      invalidFiles.push({
        fileName,
        reason: result.reason || "Failed validation",
      });
    }
  }

  const validReportPath = path.join(outputDir, "tileHexStates-valid-files.txt");
  const invalidReportPath = path.join(
    outputDir,
    "tileHexStates-invalid-files.txt",
  );
  const summaryPath = path.join(outputDir, "tileHexStates-summary.json");

  const invalidLines = invalidFiles.map(
    (item) => `${item.fileName} | ${item.reason}`,
  );

  fs.writeFileSync(validReportPath, `${validFiles.join("\n")}\n`, "utf8");
  fs.writeFileSync(invalidReportPath, `${invalidLines.join("\n")}\n`, "utf8");
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        scannedDirectory: gamesDir,
        totalFiles: allFiles.length,
        validCount: validFiles.length,
        invalidCount: invalidFiles.length,
        validReportPath,
        invalidReportPath,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`Scanned ${allFiles.length} JSON file(s) in ${gamesDir}`);
  console.log(`Valid: ${validFiles.length}`);
  console.log(`Invalid: ${invalidFiles.length}`);
  console.log(`Valid file list: ${validReportPath}`);
  console.log(`Invalid file list: ${invalidReportPath}`);
  console.log(`Summary: ${summaryPath}`);
}

main();
