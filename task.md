Use chrome-devtools to access file:///Users/ekimtco2/Downloads/Usage.html. This is a save of a real-world Gemini usage page. We would like to add some client-side quality of life improvements to it. It is known that 1% of the Current usage bar is 100 tokens. 

Write a Tampermonkey script called Limits.js that modifies the page in the following way at https://gemini.google.com/usage:
* Add Countdown to Resets at H:MM AM (example: Resets at 1:08 AM) with hours, minutes, seconds in 00:00:00 format
* Replace 24% used with (24% used, 2400 tokens) - find this one by "% used"
* Add countdown with days, hours, minutes, seconds to Resets May 26 at 8:08 AM element - figure this one out byt he dateime used
* Update Updated XX min ago (example: Updated 21 min ago) to be bold