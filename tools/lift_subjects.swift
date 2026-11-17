// Lifts the subject out of each cover with Apple's Vision framework (on-device, nothing downloaded).
// Usage: swift tools/lift_subjects.swift <covers dir> <out dir>
// Writes <name>.png masks (white = subject) and prints a coverage figure per cover.
import Foundation
import Vision
import CoreImage
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
let inDir = URL(fileURLWithPath: args[1]), outDir = URL(fileURLWithPath: args[2])
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
let ctx = CIContext()
let files = (try FileManager.default.contentsOfDirectory(at: inDir, includingPropertiesForKeys: nil)).filter { ["jpg","jpeg","png"].contains($0.pathExtension.lowercased()) }.sorted { $0.path < $1.path }
for f in files {
    guard let src = CGImageSourceCreateWithURL(f as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { continue }
    let req = VNGenerateForegroundInstanceMaskRequest()
    let h = VNImageRequestHandler(cgImage: img, options: [:])
    do {
        try h.perform([req])
        guard let obs = req.results?.first, !obs.allInstances.isEmpty else { print("none\t\(f.lastPathComponent)"); continue }
        let buf = try obs.generateScaledMaskForImage(forInstances: obs.allInstances, from: h)
        let ci = CIImage(cvPixelBuffer: buf)
        guard let cg = ctx.createCGImage(ci, from: ci.extent) else { continue }
        // coverage: share of the cover the subject takes
        let w = cg.width, hgt = cg.height
        var px = [UInt8](repeating: 0, count: w * hgt)
        let gctx = CGContext(data: &px, width: w, height: hgt, bitsPerComponent: 8, bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: 0)!
        gctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: hgt))
        let cov = Double(px.filter { $0 > 127 }.count) / Double(w * hgt)
        let out = outDir.appendingPathComponent(f.deletingPathExtension().lastPathComponent + ".png")
        let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(dest, gctx.makeImage()!, nil)
        CGImageDestinationFinalize(dest)
        print(String(format: "%.3f\t%@", cov, f.lastPathComponent))
    } catch {
        print("error\t\(f.lastPathComponent)\t\(error)")
    }
}
