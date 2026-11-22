package ch.schmidtbit.shelfmark.ui.camera

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.Handler
import android.os.Looper
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import ch.schmidtbit.shelfmark.R
import ch.schmidtbit.shelfmark.util.BarcodeDecoder
import java.util.concurrent.Executors

/** Shows [content] once the camera permission is granted, and asks for it otherwise. */
@Composable
fun WithCameraPermission(content: @Composable () -> Unit) {
    val context = LocalContext.current
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    LaunchedEffect(Unit) { if (!granted) launcher.launch(Manifest.permission.CAMERA) }
    if (granted) {
        content()
    } else {
        Column(
            Modifier.fillMaxSize().padding(32.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(stringResource(R.string.camera_permission_text), style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
            Spacer(Modifier.height(16.dp))
            Button(onClick = { launcher.launch(Manifest.permission.CAMERA) }) { Text(stringResource(R.string.camera_permission_grant)) }
        }
    }
}

/** Live camera picture, optionally feeding frames to an [analyzer] and/or an [imageCapture]. */
@Composable
fun CameraPreview(
    modifier: Modifier = Modifier,
    torch: Boolean = false,
    analyzer: ImageAnalysis.Analyzer? = null,
    imageCapture: ImageCapture? = null,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val previewView = remember {
        PreviewView(context).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
    }
    val executor = remember { Executors.newSingleThreadExecutor() }
    var camera by remember { mutableStateOf<Camera?>(null) }

    DisposableEffect(lifecycleOwner, analyzer, imageCapture) {
        val future = ProcessCameraProvider.getInstance(context)
        var provider: ProcessCameraProvider? = null
        future.addListener({
            val p = runCatching { future.get() }.getOrNull() ?: return@addListener
            provider = p
            val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
            val useCases = mutableListOf<UseCase>(preview)
            if (analyzer != null) {
                useCases += ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                    .also { it.setAnalyzer(executor, analyzer) }
            }
            if (imageCapture != null) useCases += imageCapture
            runCatching {
                p.unbindAll()
                camera = p.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, *useCases.toTypedArray())
            }
        }, ContextCompat.getMainExecutor(context))
        onDispose { provider?.unbindAll() }
    }
    DisposableEffect(Unit) { onDispose { executor.shutdown() } }
    LaunchedEffect(camera, torch) { camera?.takeIf { it.cameraInfo.hasFlashUnit() }?.cameraControl?.enableTorch(torch) }

    AndroidView(factory = { previewView }, modifier = modifier)
}

/** Hands every ISBN barcode it sees to [onIsbn], on the main thread. */
class IsbnAnalyzer(private val onIsbn: (String) -> Unit) : ImageAnalysis.Analyzer {
    private val main = Handler(Looper.getMainLooper())
    private var buffer = ByteArray(0)

    override fun analyze(image: ImageProxy) {
        image.use {
            val plane = it.planes.firstOrNull() ?: return
            val width = it.width
            val height = it.height
            if (buffer.size != width * height) buffer = ByteArray(width * height)
            val source = plane.buffer
            val rowStride = plane.rowStride
            // The row stride can be wider than the picture, so rows are copied one at a time.
            for (row in 0 until height) {
                source.position(row * rowStride)
                source.get(buffer, row * width, minOf(width, source.remaining()))
            }
            BarcodeDecoder.decodeIsbn(buffer, width, height)?.let { isbn -> main.post { onIsbn(isbn) } }
        }
    }
}

/** Full screen camera with a shutter button. Delivers the photo upright as a bitmap. */
@Composable
fun PhotoCapture(hint: String, onCaptured: (Bitmap) -> Unit, onClose: () -> Unit) {
    val context = LocalContext.current
    val capture = remember { ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY).build() }
    var busy by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        WithCameraPermission {
            CameraPreview(Modifier.fillMaxSize(), imageCapture = capture)
            Text(
                hint,
                color = Color.White,
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(start = 56.dp, end = 56.dp, top = 14.dp),
            )
            Box(Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 28.dp)) {
                if (busy) {
                    CircularProgressIndicator(color = Color.White, modifier = Modifier.size(72.dp))
                } else {
                    FilledIconButton(
                        onClick = {
                            busy = true
                            capture.takePicture(
                                ContextCompat.getMainExecutor(context),
                                object : ImageCapture.OnImageCapturedCallback() {
                                    override fun onCaptureSuccess(image: ImageProxy) {
                                        val bitmap = image.use { it.toBitmap().rotated(it.imageInfo.rotationDegrees) }
                                        busy = false
                                        onCaptured(bitmap)
                                    }

                                    override fun onError(exception: ImageCaptureException) {
                                        busy = false
                                    }
                                },
                            )
                        },
                        colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color.White),
                        modifier = Modifier.size(72.dp).testTag("shutter"),
                    ) {
                        Box(Modifier.size(56.dp).clip(CircleShape).background(Color(0xFFDDDDDD)))
                    }
                }
            }
        }
        IconButton(onClick = onClose, modifier = Modifier.statusBarsPadding().padding(4.dp)) {
            Icon(Icons.Rounded.Close, contentDescription = stringResource(R.string.action_close), tint = Color.White)
        }
    }
}

private fun Bitmap.rotated(degrees: Int): Bitmap =
    if (degrees == 0) this else Bitmap.createBitmap(this, 0, 0, width, height, Matrix().apply { postRotate(degrees.toFloat()) }, true)
