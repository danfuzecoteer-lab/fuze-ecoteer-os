#!/usr/bin/env node

const { automationsForGroup, malaysiaDateParts } = require("../api/lib/cloud-automations");
const { buildAutomationNoteContext, sendEmail } = require("../api/lib/gmail");
const { generateAutomationEmail } = require("../api/lib/openai");
const { updateGrantDatabase } = require("../api/lib/grant-database");
const { updateColdEmailCrmDatabase, updateMarketingResearchDatabase } = require("../api/lib/marketing-database");

function parseArgs(argv) {
  const args = { group: "", dryRun: false };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dry-run") {
      args.dryRun = true;
    } else if (value === "--group") {
      args.group = argv[index + 1] || "";
      index += 1;
    }
  }
  return args;
}

async function main() {
  const { group, dryRun } = parseArgs(process.argv);
  if (!group) {
    throw new Error("Missing required --group value");
  }

  const { isoDate } = malaysiaDateParts();
  const automations = automationsForGroup(group);
  if (!automations.length) {
    throw new Error(`No automations found for group: ${group}`);
  }

  console.log(`Running group ${group} for ${isoDate} (${automations.length} automation/s)`);

  for (const automation of automations) {
    const subject = `${automation.subjectPrefix} | ${isoDate}`;
    if (automation.id === "grant-database-list") {
      if (dryRun) {
        console.log(`[dry-run] ${automation.id} -> would upsert grant_opportunities in Supabase`);
        continue;
      }
      console.log(`Updating online grant database`);
      const result = await updateGrantDatabase({ runDate: isoDate, limit: 100 });
      console.log(`Upserted ${result.saved.length} grant rows into Supabase`);
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] ${automation.id} -> ${automation.to.join(", ")} :: ${subject}`);
      continue;
    }

    if (automation.id === "competition-analaysis") {
      console.log("Updating online marketing research database");
      const result = await updateMarketingResearchDatabase({ runDate: isoDate, limit: 40 });
      console.log(`Upserted ${result.saved.length} marketing research rows into Supabase`);
    }

    if (automation.id === "cold-email-crm") {
      console.log("Updating online cold-email CRM database");
      const result = await updateColdEmailCrmDatabase({ runDate: isoDate, limit: 50 });
      console.log(`Upserted ${result.saved.length} cold-email CRM rows into Supabase`);
    }

    console.log(`Generating ${automation.id}`);
    let noteContext = "";
    try {
      noteContext = await buildAutomationNoteContext(automation);
      if (noteContext) {
        console.log(`Included Gmail reply notes for ${automation.id}`);
      }
    } catch (error) {
      console.warn(`Could not load Gmail reply notes for ${automation.id}: ${error.message}`);
    }

    const body = await generateAutomationEmail(automation, isoDate, noteContext);
    const sent = await sendEmail({ to: automation.to, subject, body });
    console.log(`Sent ${automation.id}: ${sent.id || "ok"}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
