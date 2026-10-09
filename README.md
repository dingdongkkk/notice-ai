# Notice → Action

Photograph a public notice (for example a Bengaluru water-cut circular in Kannada or English) and get:

- a plain-language explanation in English, Kannada or Hindi, with a read-aloud button,
- a "does this affect me?" check of your area against the areas in the notice,
- the facts read from the notice, each with the passage it came from, shown beside the original photo,
- a calendar reminder and a family summary that are only produced after you confirm the date yourself,
- a field-by-field comparison when the notice is revised,
- answers to follow-up questions, drawn only from the facts already read from the notice,
- a matching public helpline record with its source and retrieval date.

Built for Hacktoberfest Hack Day Bengaluru '26 (PS 01, Multimodal Community Intelligence).

## Model

Notice reading is done by **Gemma 4** (`google/gemma-4-31b-it:free`), an open-weight model, called through OpenRouter from a server route. One request per image extracts the facts and writes the explanation. A follow-up question is a second, text-only request. The checklist, area check, calendar file, family summary and revision comparison are plain code with no AI calls.

## Run it

Requires Node.js 20 or newer and an OpenRouter API key.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Put your key in `.env.local` (Git-ignored), then open http://localhost:3000.

```dotenv
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=google/gemma-4-31b-it:free
```

"Load synthetic sample (no AI)" shows the interface with a hand-written fixture. It is labelled as a fixture on screen and never passes through the model.

## How it works

| File | Role |
|---|---|
| `app/api/extract/route.ts` | Sends the image to Gemma 4, validates the answer, allows one repair request, reports rate limits and timeouts |
| `app/api/ask/route.ts` | Answers a follow-up question from the validated facts only |
| `lib/openrouter.ts` | The one place that talks to OpenRouter; maps failures to messages |
| `lib/schema.ts` | Zod validation; malformed dates and times become unresolved instead of being passed on |
| `lib/prompt.ts` | Extraction prompt; text inside the notice is treated as data, not instructions |
| `lib/actions.ts` | Calendar (ICS) file with a 12-hour-before alarm, family summary, area match, revision comparison |
| `lib/data.ts` | Hand-maintained public records and the synthetic fixtures |
| `app/page.tsx` | The single page |

Key dependencies: Next.js, React, Zod.

## Limitations

- The photo is sent to a hosted AI service. Do not upload private documents.
- The model can misread a notice. Supporting passages are the model's own transcription, so check them against the photo. Kannada and Hindi output has not been reviewed by a fluent reader.
- A missing or unreadable date stays unresolved and blocks the calendar download until you enter and confirm it.
- The free endpoint is rate limited and can be unavailable.
- The external record (BWSSB helpline 1916) comes from a Deccan Herald report, not from BWSSB's own site.
- The area check is a plain text match. Spelling differences and "surrounding areas" are not caught, and the app says so.
- Read-aloud uses the device's own voices; many devices have no Kannada voice.
- Only water-interruption style notices have been considered. This is not an official government service and gives no legal advice.

## License

MIT. See [LICENSE](LICENSE).
