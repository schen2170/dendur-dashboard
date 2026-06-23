export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

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
      const response = await fetch(park.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Referer": "https://www.thrill-data.com/"
        }
      });

      const html = await response.text();

      if (html.includes("Enable JavaScript and cookies")) {
        return { name: park.name, blocked: true };
      }

      // Strip HTML tags to get plain text
      const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

      const currentMatch = text.match(/Current Average:\s*(\d+)\s*min/i);
      const todayMatch   = text.match(/Today'?s Average:\s*(\d+)\s*min/i);
      const todayTrend   = text.match(/Today[^%]*?([-+]?\d+\.?\d*)\s*%/i);
      const weekTrend    = text.match(/Last Week[^%]*?([-+]?\d+\.?\d*)\s*%/i);
      const monthTrend   = text.match(/Last Month[^%]*?([-+]?\d+\.?\d*)\s*%/i);

      return {
        name:        park.name,
        current_avg: currentMatch ? parseInt(currentMatch[1]) : null,
        today_avg:   todayMatch   ? parseInt(todayMatch[1])   : null,
        trend_today: todayTrend   ? parseFloat(todayTrend[1]) : null,
        trend_week:  weekTrend    ? parseFloat(weekTrend[1])  : null,
        trend_month: monthTrend   ? parseFloat(monthTrend[1]) : null,
        blocked:     false,
      };
    } catch (e) {
      return { name: park.name, error: e.message };
    }
  }

  const parkName = req.query.park;
  const toScrape = parkName ? PARKS.filter(p => p.name === parkName) : PARKS;
  const results  = await Promise.all(toScrape.map(scrapePark));
  res.json(results);
}
