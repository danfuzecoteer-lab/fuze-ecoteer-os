#!/usr/bin/env node

const { automationsForGroup, malaysiaDateParts } = require("../api/lib/cloud-automations");
const { buildDailyEcoFeContext } = require("../api/lib/fe-context");
const { buildAutomationNoteContext, sendEmail } = require("../api/lib/gmail");
const { generateAutomationEmail } = require("../api/lib/openai");
const { updateGrantDatabase } = require("../api/lib/grant-database");
const { updateColdEmailCrmDatabase, updateMarketingResearchDatabase } = require("../api/lib/marketing-database");
const { createOutreachDrafts } = require("../api/lib/outreach-drafts");

function parseArgs(argv) {
  const args = { group: "", dryRun: false, onlyId: "", testTo: "" };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dry-run") {
      args.dryRun = true;
    } else if (value === "--group") {
      args.group = argv[index + 1] || "";
      index += 1;
    } else if (value === "--only-id") {
      args.onlyId = argv[index + 1] || "";
      index += 1;
    } else if (value === "--test-to") {
      args.testTo = argv[index + 1] || "";
      index += 1;
    }
  }
  return args;
}

function isDatabaseAutomation(id) {
  return [
    "grant-database-list",
    "competition-analaysis",
    "cold-email-crm",
    "education-outreach-finder",
    "corporate-outreach-finder",
    "travel-outreach-finder",
  ].includes(id);
}

function isOutreachDraftAutomation(id) {
  return [
    "education-outreach-finder",
    "corporate-outreach-finder",
    "travel-outreach-finder",
  ].includes(id);
}

function crmRetryLimits() {
  const configured = Number(process.env.CRM_RESEARCH_LIMIT || 0);
  if (Number.isFinite(configured) && configured > 0) {
    const rounded = Math.round(configured);
    return [...new Set([rounded, Math.min(rounded, 5), 2])];
  }
  return [100, 35, 15, 5, 2];
}

async function updateColdEmailCrmWithRetry({ runDate }) {
  let lastError = null;
  const warnings = [];
  for (const limit of crmRetryLimits()) {
    try {
      if (lastError) {
        console.warn(`Retrying cold-email CRM update with ${limit} leads after: ${lastError.message}`);
      }
      const result = await updateColdEmailCrmDatabase({ runDate, limit });
      if (warnings.length) {
        result.warning = warnings.join(" | ");
      }
      result.requestedLimit = limit;
      return result;
    } catch (error) {
      lastError = error;
      const retryable = /JSON|Unterminated string|No JSON array|OpenAI|aborted|timeout/i.test(error.message);
      warnings.push(`CRM generation failed at limit ${limit}: ${error.message}`);
      if (!retryable) break;
    }
  }
  throw lastError;
}

async function sendStatusEmail({ automation, isoDate, status, lines }) {
  if (!isDatabaseAutomation(automation.id)) return null;
  const gmailEnvNames = ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "GMAIL_FROM"];
  const missingGmailEnv = gmailEnvNames.filter((name) => !process.env[name]);
  if (missingGmailEnv.length) {
    console.warn(`Skipping ${automation.id} status email; missing ${missingGmailEnv.join(", ")}`);
    return null;
  }

  const body = [
    `Automation: ${automation.name}`,
    `Status: ${status}`,
    `Date: ${isoDate}`,
    "",
    ...lines,
    "",
    "This is an automatic completion notice from the GitHub Actions cloud runner.",
  ].join("\n");

  return sendEmail({
    to: automation.to,
    subject: `Automation ${status} | ${automation.name} | ${isoDate}`,
    body,
  });
}

async function main() {
  const { group, dryRun, onlyId, testTo } = parseArgs(process.argv);
  if (!group) {
    throw new Error("Missing required --group value");
  }

  const { isoDate } = malaysiaDateParts();
  let automations = automationsForGroup(group);
  if (onlyId) {
    automations = automations.filter((automation) => automation.id === onlyId);
  }
  if (!automations.length) {
    throw new Error(`No automations found for group: ${group}${onlyId ? ` and id: ${onlyId}` : ""}`);
  }

  console.log(`Running group ${group} for ${isoDate} (${automations.length} automation/s)`);

  for (const automation of automations) {
    const recipients = testTo
      ? testTo.split(",").map((item) => item.trim()).filter(Boolean)
      : automation.to;
    const subject = `${automation.subjectPrefix} | ${isoDate}`;
    try {
      if (automation.id === "grant-database-list") {
        if (dryRun) {
          console.log(`[dry-run] ${automation.id} -> would upsert grant_opportunities in Supabase`);
          continue;
        }
        console.log(`Updating online grant database`);
        const grantLimit = Number(process.env.GRANT_RESEARCH_LIMIT || 70);
        const result = await updateGrantDatabase({ runDate: isoDate, limit: grantLimit });
        console.log(`Upserted ${result.saved.length} grant rows into Supabase`);
        const lines = [
          `Database updated: grant_opportunities`,
          `Rows upserted: ${result.saved.length}`,
        ];
        if (result.warning) {
          lines.push(`Warning: ${result.warning}`);
        }
        const status = await sendStatusEmail({
          automation,
          isoDate,
          status: "Completed",
          lines,
        });
        console.log(`Sent ${automation.id} completion notice: ${status && status.id ? status.id : "ok"}`);
        continue;
      }

      if (isOutreachDraftAutomation(automation.id)) {
        console.log(`${dryRun ? "Planning" : "Creating"} Gmail outreach drafts for ${automation.name}`);
        const result = await createOutreachDrafts({
          agentId: automation.id,
          runDate: isoDate,
          limit: 10,
          dryRun,
        });

        console.log(`${automation.id}: ${dryRun ? "selected" : "created"} ${dryRun ? result.selectedLeads.length : result.created.length} draft candidate/s`);
        const lines = [
          dryRun ? "Dry run only: no Gmail drafts created." : "Gmail drafts created only; no outreach emails were sent.",
          `Drafts ${dryRun ? "planned" : "created"}: ${dryRun ? result.selectedLeads.length : result.created.length}`,
          `Matched CRM leads checked: ${result.selectedLeads.length}`,
        ];
        if (result.created.length) {
          lines.push("Draft leads:");
          result.created.slice(0, 10).forEach((draft) => {
            lines.push(`- ${draft.leadName} <${draft.to}> (${draft.draftId || "draft"})`);
          });
        } else if (result.selectedLeads.length) {
          lines.push("Candidate leads:");
          result.selectedLeads.slice(0, 10).forEach((lead) => {
            lines.push(`- ${lead.organisation_name} <${lead.email}>`);
          });
        }
        if (result.skipped.length) {
          lines.push("Skipped:");
          result.skipped.slice(0, 10).forEach((item) => lines.push(`- ${item}`));
        }

        if (!dryRun) {
          const status = await sendStatusEmail({
            automation,
            isoDate,
            status: "Completed",
            lines,
          });
          console.log(`Sent ${automation.id} completion notice: ${status && status.id ? status.id : "ok"}`);
        } else {
          console.log(lines.join("\n"));
        }
        continue;
      }

      if (dryRun) {
        console.log(`[dry-run] ${automation.id} -> ${recipients.join(", ")} :: ${subject}`);
        continue;
      }

      const statusLines = [];
      if (automation.id === "competition-analaysis") {
        console.log("Updating online marketing research database");
        const result = await updateMarketingResearchDatabase({ runDate: isoDate, limit: 40 });
        console.log(`Upserted ${result.saved.length} marketing research rows into Supabase`);
        statusLines.push("Database updated: marketing_research_rows");
        statusLines.push(`Rows upserted: ${result.saved.length}`);
        if (result.warning) {
          statusLines.push(`Warning: ${result.warning}`);
        }
      }

      if (automation.id === "cold-email-crm") {
        console.log("Updating online cold-email CRM database");
        const result = await updateColdEmailCrmWithRetry({ runDate: isoDate });
        console.log(`Upserted ${result.saved.length} cold-email CRM rows into Supabase`);
        statusLines.push("Database updated: marketing_cold_email_leads");
        statusLines.push(`Rows upserted: ${result.saved.length}`);
        statusLines.push(`Generation limit used: ${result.requestedLimit}`);
        if (result.warning) {
          statusLines.push(`Warning: ${result.warning}`);
        }
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

      if (automation.id === "daily-eco-fun-facts") {
        try {
          const feContext = await buildDailyEcoFeContext(isoDate);
          noteContext = [noteContext, feContext].filter(Boolean).join("\n\n");
          console.log(`Included FE project and volunteer context for ${automation.id}`);
        } catch (error) {
          console.warn(`Could not load FE project and volunteer context for ${automation.id}: ${error.message}`);
        }
      }

      const body = await generateAutomationEmail(automation, isoDate, noteContext);
      const sent = await sendEmail({ to: recipients, subject, body });
      console.log(`Sent ${automation.id}: ${sent.id || "ok"}`);

      if (statusLines.length) {
        statusLines.push(`Brief email sent: ${sent.id || "ok"}`);
        const status = await sendStatusEmail({
          automation,
          isoDate,
          status: "Completed",
          lines: statusLines,
        });
        console.log(`Sent ${automation.id} completion notice: ${status && status.id ? status.id : "ok"}`);
      }
    } catch (error) {
      console.error(`${automation.id} failed: ${error.message}`);
      try {
        const status = await sendStatusEmail({
          automation,
          isoDate,
          status: "Failed",
          lines: [
            `Error: ${error.message}`,
            "Check the GitHub Actions run logs for the full trace.",
          ],
        });
        if (status) {
          console.log(`Sent ${automation.id} failure notice: ${status.id || "ok"}`);
        }
      } catch (emailError) {
        console.warn(`Could not send ${automation.id} failure notice: ${emailError.message}`);
      }
      throw error;
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
