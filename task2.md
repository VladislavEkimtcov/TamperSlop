## Proposed Metrics for Gemini Usage Tracker (Limits.js enhancements)

To get a tighter grip on compute limits and optimize prompt pacing, please implement the following new metric inserted in the Limits.js Tampermonkey script:

**Week-Level Time to Depletion (TTD)**: A dynamic countdown estimating exactly when the weekly 100% cap will be hit, based on the current usage percent burn rate.
Location: the weekly use percentage XX% used (example: 22% used)

Turns pleasant but alarming red if we are on track to run out of usage by the end of the week to highlight if the current daily use % daily quota is cannibalizing the weekly quota at an unsustainable rate. This will require comparing the "ideal rate" consumption that would result in hitting 100% on the last second of the weekly reset:
```html
<p _ngcontent-ng-c311756920="" class="gds-emphasized-body-m">22% used</p>
```

inside of

```html
<div _ngcontent-ng-c311756920="" data-test-id="gxu-weekly" class="gxu-weekly gxu-weekly-luminous"><div _ngcontent-ng-c311756920=""><p _ngcontent-ng-c311756920="" class="gds-emphasized-body-m">Weekly limit</p><p _ngcontent-ng-c311756920="" class="gds-emphasized-body-s reset-time-luminous">Resets May 26 at 8:08 AM (4d 00:11:00)</p></div><p _ngcontent-ng-c311756920="" class="gds-emphasized-body-m">22% used</p></div>
```

Since it is not currently possible to estimate weekly token use, the weekly cap calculations run entirely off percentage