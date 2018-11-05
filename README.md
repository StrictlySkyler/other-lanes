# harbormaster-other-lanes

A Harbor for executing other Lanes.

![](https://github.com/strictlyskyler/harbormaster-other-lanes/raw/develop/other-lanes.png)

This harbor allows you to specify other lanes which it will track, and report their status as its own.  For example, if configured to ship to `lane1` and `lane2`, this harbor will succeed if both `lane1` and `lane2` also succeed.  If either fail, this harbor will report as a failure.

If the option to follow Charters is checked, the result if this lane's shipment will be dependent not only upon the lanes selected, but their downstream followups and salvage plans as well.
