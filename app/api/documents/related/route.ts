import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { findDocuments, searchText } from "@/lib/retrieve";
import { parseNotice } from "@/lib/schema";

// Earlier saved notices that look related to the one on screen: the same
// sender, or the most similar by meaning. No AI answer is written here.
export async function POST(req: Request) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ related: [] });
  const body = await req.json().catch(() => null);
  let notice;
  try {
    notice = parseNotice(body?.notice);
  } catch {
    return NextResponse.json({ error: "The notice data was not valid." }, { status: 400 });
  }
  const same = JSON.stringify(notice);
  const issuer = (notice.issuer ?? "").toLowerCase();
  const found = (await findDocuments(user.id, searchText(notice), 6)).filter(
    (d) => JSON.stringify(d.notice) !== same,
  );
  const related = found
    .filter(
      (d) =>
        d.notice.category === notice.category ||
        (issuer && (d.notice.issuer ?? "").toLowerCase() === issuer),
    )
    .slice(0, 3);
  return NextResponse.json({ related });
}
