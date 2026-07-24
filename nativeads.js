/* ============================================================================
 * IMPROVS2 — native ads bridge (web side)
 * Connects the in-page AdManager (already in your HTML, v423+) to the native
 * AppLovin MAX Capacitor plugin (AdMaxPlugin). On the plain web / file:// build
 * the Capacitor plugin isn't present, so this stays inert and the app behaves
 * exactly as before (AdManager's bridge defaults to a no-op).
 *
 * DROP-IN: place this file next to index.html and add, right before </body>
 * and AFTER your main app script:
 *     <script src="nativeads.js"></script>
 * ============================================================================ */
(function () {
  // ── YOUR APPLOVIN MAX KEYS (from the MAX dashboard → Account → Keys / Ad Units) ──
  var SDK_KEY           = 'YOUR_APPLOVIN_SDK_KEY';
  var INTERSTITIAL_UNIT = 'YOUR_INTERSTITIAL_AD_UNIT_ID';
  var REWARDED_UNIT     = 'YOUR_REWARDED_AD_UNIT_ID';

  // wait for both the Capacitor plugin and the in-page AdManager to exist
  function whenReady(cb) {
    var tries = 0;
    (function poll() {
      var plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AdMax;
      if (plugin && typeof AdManager !== 'undefined') { cb(plugin); return; }
      if (tries++ > 100) return;            // ~10s, then give up silently (web build / plugin absent)
      setTimeout(poll, 100);
    })();
  }

  whenReady(function (AdMax) {
    var interReady = false, rewardReady = false, pendingReward = null;

    // Cache readiness from events so AdManager.bridge.isReady() can answer SYNCHRONOUSLY.
    AdMax.addListener('interstitialLoaded',    function () { interReady = true; });
    AdMax.addListener('interstitialDisplayed', function () { interReady = false; });
    AdMax.addListener('interstitialFailed',    function () { interReady = false; });
    AdMax.addListener('interstitialHidden',    function () { interReady = false; try { AdManager.adHidden(); } catch (e) {} });

    AdMax.addListener('rewardedLoaded',    function () { rewardReady = true; });
    AdMax.addListener('rewardedDisplayed', function () { rewardReady = false; });
    AdMax.addListener('rewardedFailed',    function () { rewardReady = false; });
    AdMax.addListener('rewardedHidden',    function () {
      rewardReady = false;
      try { AdManager.rewardedHidden(); } catch (e) {}
      if (pendingReward) { var r = pendingReward; pendingReward = null; grantReward(r); }   // grant AFTER the view completes
    });
    AdMax.addListener('userRewarded', function (reward) { pendingReward = reward || { granted: true }; });

    function grantReward(reward) {
      // Fires ONLY after a fully-watched rewarded ad. Wire this to your economy
      // (tokens / aura / unlock). window.onAdReward can be defined in your app.
      try { if (window.onAdReward) window.onAdReward(reward); } catch (e) {}
      console.log('[ADS] reward granted', reward);
    }

    // The interface AdManager expects (isReady/show/load + rewarded variants).
    window.NativeAds = {
      isReady:         function () { return interReady; },
      show:            function () { AdMax.showInterstitial(); },
      load:            function () { AdMax.loadInterstitial(); },
      isRewardedReady: function () { return rewardReady; },
      showRewarded:    function () { AdMax.showRewarded(); return true; },
      loadRewarded:    function () { AdMax.loadRewarded(); },
    };

    // hand the real bridge to the gatekeeper (merges over the no-op default)
    AdManager.configure({ bridge: window.NativeAds });

    // initialize MAX — the native side loads the first interstitial + rewarded on init-complete
    AdMax.initialize({ sdkKey: SDK_KEY, interstitialUnitId: INTERSTITIAL_UNIT, rewardedUnitId: REWARDED_UNIT });

    // keep audio sane when the OS backgrounds the app (calls, home button)
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
        window.Capacitor.Plugins.App.addListener('appStateChange', function (s) {
          try { var ac = window.getAC && window.getAC(); if (!ac) return;
                if (s && s.isActive === false) ac.suspend(); else ac.resume(); } catch (e) {}
        });
      }
    } catch (e) {}
  });
})();
