## Proposed Metrics for Gemini Usage Tracker (Limits.js enhancements)

To get a tighter grip on compute limits and optimize prompt pacing, please implement the following new metrics inserted in the Limits.js Tampermonkey script:

1. **Token Burn Rate (Velocity)**: Calculate a moving average of tokens consumed per hour/minute by dividing the "Current Usage" token count stat by time since the current period began. This can be calculated by subtracting 5 hours from the reset time.
Location: opposite (right) end  of 
```html
<p _ngcontent-ng-c311756920="" class="gds-emphasized-body-m reset-time-luminous">Resets at 6:08 AM (04:38:30)</p>
```
in the did, regardless of how it is detected in the code.

2. **Time to Depletion (TTD)**: A dynamic countdown estimating exactly when the 100% cap will be hit, based on the current token burn rate.
Location: separated from Token Burn Rate with a slash, for a "X,XXX tok/hr / 11:11:11 burnout" result. Turns pleasant but alarming red if we are on track to run out of usage by the end of the week to highlight if maximizing the daily quota is cannibalizing the weekly quota at an unsustainable rate. This will require comparing the "ideal rate" consumption that would result in hitting 100% on the last second of the reset to the one exhibited by taking the weekely use, seen in elements like:
```html
<p _ngcontent-ng-c311756920="" class="gds-emphasized-body-m">20% used</p>
```

inside of

```html
<div _ngcontent-ng-c311756920="" data-test-id="gxu-weekly" class="gxu-weekly gxu-weekly-luminous"><div _ngcontent-ng-c311756920=""><p _ngcontent-ng-c311756920="" class="gds-emphasized-body-m">Weekly limit</p><p _ngcontent-ng-c311756920="" class="gds-emphasized-body-s reset-time-luminous">Resets May 26 at 8:08 AM (4d 06:33:34)</p></div><p _ngcontent-ng-c311756920="" class="gds-emphasized-body-m">20% used</p></div>
```
