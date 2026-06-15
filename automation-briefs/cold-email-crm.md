Run date: ${runDate}
Task: Create up to ${limit} cold-email CRM prospect rows for Fuze Ecoteer.

Return a balanced weekly prospect set across these five lead segments:
1. School
2. Tadika / Preschool
3. University
4. Corporate HR / CSR
5. Travel website / Travel agent / Referral Partner

Lead volume rules:
* If ${limit} is 100 or more, return exactly 20 leads per segment each time.
* If ${limit} is below 100, distribute leads as evenly as possible across the five segments.
* Do not overfill one segment unless there are not enough credible leads in another segment.
* Return no more than ${limit} total rows.

Travel website / Travel agent / Referral Partner rules:
* Prioritize travel websites, travel agents, volunteer travel platforms, gap-year companies, responsible tourism sites, travel media, career-break partners, influencers, travel bloggers, eco-tourism directories, responsible travel publishers, and collaboration or referral partners for PTP, PMRS, and PEEP.
* At least 50% of Network / Referral Partner leads must be travel, tourism, media, referral, partnership, influencer, publisher, or volunteer-travel outlets.
* Do not put any schools, universities, taska, tadika, daycare centres, preschools, general education providers, or corporate HR / CSR leads in this segment.
* Use lead_segment exactly as Network / Referral Partner for travel websites, travel agents, tourism platforms, volunteer travel sites, travel media, influencers, publishers, responsible tourism directories, and referral partners.

Research quality requirements:
* Do enough research that a later email-writing agent can write a specific, personalised cold email.
* Do not write outreach emails.
* Do not use generic notes such as "good fit for eco-tourism" unless supported by evidence.
* Prefer organisations with clear evidence of relevance to conservation, education, student travel, CSR, sustainability, volunteering, outdoor learning, experiential learning, marine conservation, Malaysia travel, or youth development.
* Include source URLs inside research_notes.
* When a source is uncertain, say so clearly in research_notes.
* Do not invent facts, names, emails, partnerships, social activity, or recent news.

Contact rules:
* Do not invent emails.
* Only include an email when it is an actual public contact email you found on a public source.
* If you include an email, the exact email address must also appear in research_notes together with the public source URL where it was found.
* Prefer official enquiry emails, department emails, admissions emails, CSR or HR contact emails, partnership emails, or official contact-page emails.
* Do not guess email patterns from names, domains, or job titles.
* Use null for email when no confident public email is available.
* Use null for contact_name when no confident individual decision-maker is found.
* If using a generic contact point, describe the likely department in contact_department.
* linkedin_url should be the organisation or relevant decision-maker LinkedIn URL when confidently found; otherwise use null.

Output format:
Return only a valid JSON array.
Do not include markdown.
Do not include explanations before or after the JSON.
Do not wrap the JSON in code fences.

Each JSON object must use exactly these keys:
lead_segment,
organisation_name,
country,
city,
website,
contact_department,
contact_name,
email,
linkedin_url,
research_notes,
likely_need,
recommended_offer,
personalization_angle,
priority,
next_action,
source,
confidence

Field rules:
* lead_segment must be exactly one of:
  * School
  * Tadika / Preschool
  * University
  * Corporate HR / CSR
  * Network / Referral Partner
* priority must include both a band and a score, using one of these formats:
  * Priority A - 90/100 to 100/100
  * Priority B - 75/100 to 89/100
  * Priority C - 60/100 to 74/100
  * Nurture - 40/100 to 59/100
  * Low priority - 0/100 to 39/100
* research_notes must include:
  * evidence of fit
  * recent activity or visible current activity, if found
  * LinkedIn or social media summary, if found
  * likely decision-maker or relevant department
  * buyer motivation
  * likely pain point
  * timing relevance
  * caution, uncertainty, or data gap
  * source URLs
  * the exact public email address and its source URL when email is not null
* likely_need must describe the practical need Fuze Ecoteer could help with.
* recommended_offer must recommend the most relevant Fuze Ecoteer offer, such as:
  * school camps
  * outdoor education
  * conservation-based student programmes
  * corporate volunteering
  * CSR partnership
  * turtle conservation volunteering
  * marine conservation programme
  * responsible tourism referral partnership
  * PTP, PMRS, or PEEP collaboration
* personalization_angle must be a concise hook for a future email-writing agent.
  * It must not be outreach copy.
  * It should be specific enough to support a personalised first line.
* next_action must state the practical follow-up step, such as:
  * send tailored cold email
  * connect on LinkedIn
  * use enquiry form
  * find CSR manager
  * verify contact email
  * pitch referral partnership
  * research recent school trip activity before outreach
* source must summarize the main source type used, such as:
  * official website
  * LinkedIn
  * Facebook
  * Instagram
  * article
  * directory
  * contact page
  * search result phrase
* confidence must be a number from 0 to 1.
  * Use higher confidence only when website, fit, and contact route are clearly supported.
  * Use lower confidence when fit is plausible but contact data or recent activity is weak.
  * Use null only where a specific field is unknown, not for confidence itself.

Quality control before returning:
* Check that the total row count does not exceed ${limit}.
* Check that the five segments are balanced according to the lead volume rules.
* Check that at least half of Network / Referral Partner leads are genuine travel, tourism, media, referral, influencer, publisher, or volunteer-travel outlets.
* Check that every object has exactly the required keys.
* Check that the JSON is valid and parseable.
* Check that no private personal emails or unsupported claims have been invented.
