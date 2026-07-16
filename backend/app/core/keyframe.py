import cv2
import numpy as np

class MotionKeyframeExtractor:
    def __init__(self, history_size=30, fallback_threshold=5.0):
        self.history_size = history_size
        self.fallback_threshold = fallback_threshold
        self.prev_frame = None
        self.diff_history = []

    def process_frame(self, frame) -> tuple[bool, float, float]:
        """
        Processes a single BGR/RGB frame and returns a tuple (is_keyframe, avg_diff, threshold).
        Converts the image to grayscale, applies a Gaussian blur to reduce high-frequency noise,
        computes the absolute difference with the previous frame, and updates the rolling history.
        """
        # Convert to grayscale
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        # Apply Gaussian filter for noise reduction
        gray = cv2.GaussianBlur(gray, (5, 5), 0)

        if self.prev_frame is None:
            self.prev_frame = gray
            # First frame is always a keyframe by default as a starting point
            return True, 0.0, self.fallback_threshold

        # Compute absolute difference
        diff = cv2.absdiff(gray, self.prev_frame)
        avg_diff = float(np.mean(diff))
        self.prev_frame = gray

        # Get threshold from buffer history
        if len(self.diff_history) >= 5:
            mean_val = float(np.mean(self.diff_history))
            std_val = float(np.std(self.diff_history))
            threshold = mean_val + std_val
        else:
            threshold = self.fallback_threshold

        # Append current diff to history and maintain size
        self.diff_history.append(avg_diff)
        if len(self.diff_history) > self.history_size:
            self.diff_history.pop(0)

        # A keyframe is detected if average difference exceeds threshold
        is_keyframe = avg_diff > threshold
        return is_keyframe, avg_diff, threshold
