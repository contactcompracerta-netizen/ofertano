import {
  isAllowedAwinDownloadUrl,
  parseAwinFeedListCsv,
  selectAwinFeed,
} from "./awinFeedSource";

let passed = 0;

function ok(condition: boolean, label: string): void {
  if (!condition) throw new Error(`FAIL: ${label}`);
  passed += 1;
}

function expectThrows(fn: () => unknown, includes: string, label: string): void {
  try {
    fn();
  } catch (error) {
    ok(
      error instanceof Error && error.message.includes(includes),
      `${label}: erro esperado`,
    );
    return;
  }
  throw new Error(`FAIL: ${label} deveria lançar`);
}

const listCsv = [
  "Advertiser ID,Advertiser Name,Primary Region,Membership Status,Feed ID,Feed Name,Language,Vertical,Last Imported,URL",
  '101,"KaBuM!",BR,Joined,9001,"Retail BR",Portuguese,Retail,2026-10-09 01:00:00,"https://datafeed.api.productserve.com/datafeed/download/apikey/redacted/fid/9001/format/csv/language/pt_BR/delimiter/%2C/compression/gzip/"',
  '202,"Leveros",BR,Joined,9002,"Retail BR",Portuguese,Retail,2026-10-09 01:00:00,"https://productdata.awin.com/datafeed/download/apikey/redacted/fid/9002/format/csv/"',
].join("\n");

const feeds = parseAwinFeedListCsv(listCsv);
ok(feeds.length === 2, "lista AWIN parseia 2 feeds");
ok(feeds[0].advertiserId === "101", "advertiser id");
ok(feeds[0].feedId === "9001", "feed id");
ok(feeds[0].membershipStatus === "Joined", "membership status");

ok(
  isAllowedAwinDownloadUrl(feeds[0].downloadUrl),
  "host productserve permitido",
);
ok(
  isAllowedAwinDownloadUrl(feeds[1].downloadUrl),
  "host productdata permitido",
);
ok(
  !isAllowedAwinDownloadUrl("https://evil.example/feed.csv"),
  "host externo bloqueado",
);
ok(
  !isAllowedAwinDownloadUrl("http://productdata.awin.com/feed.csv"),
  "http bloqueado",
);

const kabum = selectAwinFeed(feeds, "101");
ok(kabum.feedId === "9001", "seleção única por advertiser");

expectThrows(
  () =>
    selectAwinFeed(
      [
        ...feeds,
        { ...feeds[0], feedId: "9003", feedName: "Outro feed" },
      ],
      "101",
    ),
  "AWIN_FEED_AMBIGUOUS",
  "múltiplos feeds exigem feedId explícito",
);

const explicit = selectAwinFeed(
  [...feeds, { ...feeds[0], feedId: "9003", feedName: "Outro feed" }],
  "101",
  "9003",
);
ok(explicit.feedId === "9003", "feedId explícito resolve ambiguidade");

expectThrows(
  () =>
    selectAwinFeed(
      [{ ...feeds[0], advertiserId: "303", membershipStatus: "Not Joined" }],
      "303",
    ),
  "AWIN_ADVERTISER_NOT_JOINED",
  "advertiser não aprovado é bloqueado",
);

expectThrows(
  () => selectAwinFeed(feeds, "999"),
  "AWIN_FEED_NOT_FOUND",
  "advertiser ausente",
);

console.log(`awinFeedSource.test.ts PASS (${passed} asserções)`);
