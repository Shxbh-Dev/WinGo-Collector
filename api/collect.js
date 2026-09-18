const WIN_GO_API =
  "https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json";

export default async function handler(req, res) {
  try {
    // -----------------------------
    // SECURITY TOKEN
    // -----------------------------
    const token = req.query.token;

    if (!process.env.COLLECTOR_TOKEN) {
      return res.status(500).json({
        success: false,
        error: "COLLECTOR_TOKEN is not configured"
      });
    }

    if (token !== process.env.COLLECTOR_TOKEN) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });
    }

    // -----------------------------
    // CHECK SUPABASE CONFIG
    // -----------------------------
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        success: false,
        error: "Supabase environment variables missing"
      });
    }

    // -----------------------------
    // GET WINGO DATA
    // -----------------------------
    const response = await fetch(
      WIN_GO_API + "?_=" + Date.now(),
      {
        method: "GET",
        headers: {
          Accept: "application/json, text/plain, */*",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36"
        }
      }
    );

    const body = await response.text();

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        source: "wingo",
        httpStatus: response.status,
        response: body.slice(0, 1000)
      });
    }

    let json;

    try {
      json = JSON.parse(body);
    } catch {
      return res.status(502).json({
        success: false,
        error: "WinGo API did not return JSON",
        response: body.slice(0, 1000)
      });
    }

    // -----------------------------
    // EXACT STRUCTURE FROM YOUR HTML
    // -----------------------------
    const list = json?.data?.list;

    if (!Array.isArray(list)) {
      return res.status(502).json({
        success: false,
        error: "data.data.list not found",
        apiResponse: JSON.stringify(json).slice(0, 2000)
      });
    }

    // -----------------------------
    // NORMALIZE RESULTS
    // -----------------------------
    const records = list
      .map(item => {
        const issue = String(
          item?.issueNumber ?? ""
        ).trim();

        const result = Number(item?.number);

        if (
          !issue ||
          !Number.isInteger(result) ||
          result < 0 ||
          result > 9
        ) {
          return null;
        }

        return {
          issue,
          result,
          side: result >= 5 ? "BIG" : "SMALL"
        };
      })
      .filter(Boolean);

    if (!records.length) {
      return res.status(502).json({
        success: false,
        error: "No valid records found"
      });
    }

    // -----------------------------
    // SAVE TO SUPABASE
    // -----------------------------
    const supabaseResponse = await fetch(
      `${supabaseUrl}/rest/v1/wingo_results?on_conflict=issue`,
      {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer:
            "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(records)
      }
    );

    const supabaseBody =
      await supabaseResponse.text();

    if (!supabaseResponse.ok) {
      return res.status(502).json({
        success: false,
        source: "supabase",
        httpStatus: supabaseResponse.status,
        response: supabaseBody.slice(0, 1000)
      });
    }

    // -----------------------------
    // SUCCESS
    // -----------------------------
    return res.status(200).json({
      success: true,
      received: list.length,
      saved: records.length,
      latestIssue: records[0].issue,
      latestNumber: records[0].result,
      latestSide: records[0].side,
      collectedAt: new Date().toISOString()
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || String(error)
    });
  }
}
