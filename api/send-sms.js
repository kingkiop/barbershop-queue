export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ error: "Missing 'to' or 'message'" });
  }

  // Clean phone number — remove spaces, dashes, parens
  let cleanNumber = to.replace(/[\s\-\(\)]/g, "");
  // Add +1 if not present (US numbers)
  if (!cleanNumber.startsWith("+")) {
    if (cleanNumber.startsWith("1")) {
      cleanNumber = "+" + cleanNumber;
    } else {
      cleanNumber = "+1" + cleanNumber;
    }
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    return res.status(500).json({ error: "Twilio credentials not configured" });
  }

  try {
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    
    const params = new URLSearchParams();
    params.append("To", cleanNumber);
    params.append("From", fromNumber);
    params.append("Body", message);

    const response = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (response.ok) {
      return res.status(200).json({ success: true, sid: data.sid });
    } else {
      return res.status(400).json({ success: false, error: data.message });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

