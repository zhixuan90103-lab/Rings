import UIKit
import Capacitor

/// Registers local plugins and locks portrait orientation.
@objc(BridgeViewController)
final class BridgeViewController: CAPBridgeViewController {
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        .portrait
    }

    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation {
        .portrait
    }

    override var shouldAutorotate: Bool {
        false
    }

    /// First swipe from an edge stays in the game. A second swipe still goes Home or opens Control Center.
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge {
        .all
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(AdvancedHapticsPlugin())
        CAPLog.print("⚡️ AdvancedHapticsPlugin registered")
    }
}
