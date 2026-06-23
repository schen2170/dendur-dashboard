import * as cheerio from "cheerio";

const PARKS = [
  { name: "Six Flags Magic Mountain",    url: "https://www.thrill-data.com/waits/park/six-flags/magic-mountain/"    },
  { name: "Six Flags Great Adventure",   url: "https://www.thrill-data.com/waits/park/six-flags/great-adventure/"   },
  { name: "Six Flags Over Georgia",      url: "https://www.thrill-data.com/waits/park/six-flags/over-georgia/"      },
  { name: "Six Flags Over Texas",        url: "https://www.thrill-data.com/waits/park/six-flags/over-texas/"        },
  { name: "Six Flags America",           url: "https://www.thrill-data.com/waits/park/six-flags/america/"           },
  { name: "Six Flags Great America",     url: "https://www.thrill-data.com/waits/park/six-flags/great-america/"     },
  { name: "Six Flags Fiesta Texas",      url: "https://www.thrill-data.com/waits/park/six-flags/fiesta-texas/"      },
  { name: "Six Flags New England",       url: "https://www.thrill-data.com/waits/park/six-flags/new-england/"       },
  { name: "Six Flags St. Louis",         url: "https://www.thrill-data.com/waits/park/six-flags/saint-louis/"       },
  { name: "Six Flags Discovery Kingdom", url: "https://www.thrill-data.com/waits/park/six-flags/discovery-kingdom/" },
  { name: "Cedar Point",                 url: "https://www.thrill-data.com/waits/park/cedar-fair/cedar-point/"      },
];

async function scrapePark(park) {
  try {
    const res = await fetch(park.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": "https://www.thrill-data.com/"
      }
    });

    const html = await res.text();

    if (html.includes("Enable JavaScript and cookies")) {
      return { name: park.name, blocked: true };
    }

    const $ = cheerio.load(html);
    const bodyText = $("body").text();

    // Current average
    const currentMatch = bodyText.match(/Current Average:\s*(\d+)\s*min/i);
    const todayMatch   = bodyText.match(/Today's Average:\s*(\d+)\s*min/i);

    // Trend percentages
    const trendMatches = bodyText.match(/([-+]?\d+\.?\d*)\s*%/g) || [];
    const trends = trendMatches.map(t => parseFloat(t)).filter(n => !isNaN(n));

    return {
      name:          park.name,
      current_avg:   currentMatch ? parseInt(currentMatch[1]) : null,
      today_avg:     todayMatch   ? parseInt(todayMatch[1])   : null,
      trend_today:   trends[0] ?? null,
      trend_week:    trends[1] ?? null,
      trend_month:   trends[2] ?? null,
      blocked:       false,
    };
  } catch (e) {
    return { name: park.name, error: e.message };
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const park = req.query.park;
  const parksToScrape = park
    ? PARKS.filter(p => p.name === park)
    : PARKS;

  const results = await Promise.all(parksToScrape.map(scrapePark));
  res.json(results);
}

export const config = {
  runtime: "edge",
};
