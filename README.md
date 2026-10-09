# Notice → Action

**Know what a notice means for your household, what changed, and what to do next, with proof.**

Photograph an official document in Kannada or English and the app turns it into a plan. It is built around four kinds: water-cut notices, scholarship notices, government circulars and orders, and legal notices or court papers. For each one it:

1. **Explains it** in English, Kannada or Hindi, in short sentences, with a read-aloud button.
2. **Shows where each fact came from.** Every date, area, amount, document and condition has a "Show me where" button that reveals the passage it was read from, next to the photo. Facts are labelled *From your notice*, *External source* or *Needs confirmation*.
3. **Checks whether it affects your family.** An optional household profile (locality, water provider, student, senior citizen) is compared with the notice. The answer is one of *Matches the stated conditions*, *Doesn't match a stated condition* or *Need more information*, with the reason for each.
4. **Gets you ready for a visit.** Required documents become a tick list that counts what is still missing; the office named in the notice is shown, and any office from an outside source is marked as a candidate with "confirm before travelling".
5. **Sets a reminder only after you approve.** You confirm the date against the notice, then download a calendar file. An unreadable date blocks the reminder until you type it in.
6. **Makes a card for the family.** A large-text card (what happened, when, what to do) that separates the notice's own instructions from suggested precautions, hides personal details by default, and is shared through the phone's share sheet.
7. **Handles a corrected notice.** Upload the newer version and the app says what changed in plain sentences ("The date moved later by 2 days"), counts the updates your plan needs, and updates the saved reminder instead of adding a second one.
8. **Answers follow-up questions** from the facts already read from the notice.
9. **Explains the fine print.** For circulars and legal papers it lists what the document says will happen if you do not act, the laws and rules it names, and its official words in everyday language.

### Legal documents

The app explains what a legal document says. It does not say whether a claim is valid, what you should do about it, or what a court will decide, and the model is instructed not to. A "This is not legal advice" notice is shown on every legal document, with the NALSA free legal aid helpline (15100). A deadline counted from another event, such as "within 15 days of receipt", is left unresolved for you to work out and enter.

Built for Hacktoberfest Hack Day Bengaluru '26 (PS 01, Multimodal Community Intelligence).

## Built for older users and phones

- Set in Atkinson Hyperlegible, a typeface designed for readers with low vision, with A / A+ / A++ buttons that scale the whole page and are remembered on the device.
- Numbered steps, big buttons (56 px minimum), full-width on phones, with a "Take a photo" button that opens the camera. The upload buttons are on the first screen.
- The result opens with the headline and a calendar-style date tile, and a row of section links stays at the top while you scroll.
- Tap the photo to enlarge it. On wide screens the photo and facts stay beside the explanation.
- High-contrast colours in light and dark mode. Status is never shown by colour alone.
- Keyboard and screen-reader support: labelled fields, visible focus, live status messages, and language tags on Kannada and Hindi text.

The whole interface switches between English, Kannada and Hindi with the language picker, and the choice is remembered. Text the model writes (explanation, checklist, family card) is in the language chosen when the photo was read. The built-in samples, the external contact records and server error messages stay in English.

## Model

Notice reading is done by **Gemma 4**, an open-weight model. The app can call it through either of two hosts:

- **Google AI Studio** (`GEMINI_API_KEY`), using `gemma-4-26b-a4b-it` by default. This is what the app has been tested with.
- **OpenRouter** (`OPENROUTER_API_KEY`), using `google/gemma-4-31b-it:free`. This path has not been run.

One request per photo extracts the facts and writes the explanation. The browser sends the whole photo plus enlarged top and bottom halves, because the host shows the model each image at a fixed low resolution. The model's thinking mode is switched off to keep answers fast. A follow-up question is a second, text-only request. Everything else (household check, checklists, calendar file, family card, revision comparison) is plain code with no AI calls.

### What has been tested live

Two synthetic water-cut notices in `samples/` (one English, one Kannada) were read through the running app, each taking about 20 seconds. Both gave the right date, time and areas. On the Kannada one the model misread a vowel in one place name ("ಮತ್ತಿಕೇರೆ" for "ಮತ್ತಿಕೆರೆ"), which is why area matching allows small spelling differences. A synthetic English scholarship notice was also read through the page itself in about 20 seconds, with the right deadline, office and conditions. No real photographed notice, circular or legal paper has been read live yet. The larger `gemma-4-31b-it` model took 30 seconds to two minutes in the same tests and sometimes returned "high demand" errors.

## Where your data goes

- The photo, and the facts read from it when you ask a follow-up question, are sent to the model host (Google AI Studio or OpenRouter). The app says so before upload. Nothing is processed on the device.
- The household profile, text size, language and saved reminders are kept in the browser's local storage and are not sent to the server or the model.
- The server keeps a result in memory to avoid repeating a request for the same image; it writes nothing to disk.
- Sharing happens only when you press Share or Copy.

## Run it

Requires Node.js 20 or newer and a Google AI Studio or OpenRouter API key.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Put your key in `.env.local` (Git-ignored), then open http://localhost:3000.

```dotenv
GEMINI_API_KEY=your_key_here
```

"Try an example" loads a hand-written water-cut notice (with a corrected version), scholarship notice, government circular or legal notice. Samples are labelled on screen and never pass through the model.

## How it works

| File | Role |
|---|---|
| `app/api/extract/route.ts` | Sends the image to Gemma 4, validates the answer, allows one repair request, reports rate limits and timeouts |
| `app/api/ask/route.ts` | Answers a follow-up question from the validated facts only |
| `lib/openrouter.ts` | The one place that talks to the model host (Google AI Studio or OpenRouter); maps failures to messages |
| `samples/` | Two synthetic notice images for testing, and the script that draws them |
| `lib/schema.ts` | Zod validation; malformed dates and times become unresolved instead of being passed on |
| `lib/prompt.ts` | Prompts; text inside the notice is treated as data, not instructions |
| `lib/actions.ts` | Household check, calendar file, saved reminders, family card, revision comparison |
| `lib/data.ts` | Hand-maintained public records and the synthetic samples |
| `lib/i18n.ts` | Interface text and family card labels in English, Kannada and Hindi |
| `lib/store.ts` | Browser local storage hook |
| `app/page.tsx` | The single page |
| `app/icons.tsx` | Inline SVG icons |

Key dependencies: Next.js, React, Zod.

## Limitations

- The model can misread a notice. "Show me where" passages are the model's own transcription, not a highlighted region of the image, so compare them with the photo.
- Kannada and Hindi text, both the interface translations in `lib/i18n.ts` and what the model writes, has not been reviewed by a fluent reader.
- The household check is a plain comparison. Area matching misses spelling differences and "surrounding areas"; conditions other than student or senior citizen are reported as "cannot be checked". It never decides eligibility.
- Personal details are hidden using what the model listed plus long digit runs. Read the card before sharing.
- External records for BWSSB (helpline 1916, head office address) come from third-party pages, not BWSSB's own site, and no opening hours are held. The NALSA helpline (15100) is taken from nalsa.gov.in.
- Legal papers usually carry names, addresses and case numbers, and the photo is sent to a hosted service. Cover what you can before photographing, or do not upload it.
- Nothing here is legal advice, and no lawyer has reviewed how legal documents are explained.
- A calendar may or may not treat the re-downloaded file as an update to the earlier event.
- Read-aloud uses the device's own voices; many devices have no Kannada voice.
- The model host is rate limited and can be busy; the app shows a message and does not retry by itself.
- Live testing so far is two synthetic water-cut notices; see "What has been tested live". This is not an official government service and gives no legal advice.

## License

MIT. See [LICENSE](LICENSE).
