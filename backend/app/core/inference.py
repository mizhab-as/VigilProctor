import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import cv2

class PlaceholderCNN(nn.Module):
    def __init__(self):
        super(PlaceholderCNN, self).__init__()
        # Conv2D(32,3) -> MaxPool -> Conv2D(32,3) -> MaxPool -> Conv2D(32,2) -> MaxPool ->
        # Conv2D(32,2) -> MaxPool -> Conv2D(32,2) -> MaxPool -> Dropout(0.5) -> Conv2D(32,2) -> MaxPool ->
        # Flatten -> Dense(50,relu) -> Dense(5,softmax)
        
        self.conv1 = nn.Conv2d(3, 32, kernel_size=3, padding=1)
        self.pool1 = nn.MaxPool2d(2, 2) # 224 -> 112
        
        self.conv2 = nn.Conv2d(32, 32, kernel_size=3, padding=1)
        self.pool2 = nn.MaxPool2d(2, 2) # 112 -> 56
        
        self.conv3 = nn.Conv2d(32, 32, kernel_size=2, padding=0)
        self.pool3 = nn.MaxPool2d(2, 2) # 56 -> 27
        
        self.conv4 = nn.Conv2d(32, 32, kernel_size=2, padding=0)
        self.pool4 = nn.MaxPool2d(2, 2) # 27 -> 13
        
        self.conv5 = nn.Conv2d(32, 32, kernel_size=2, padding=0)
        self.pool5 = nn.MaxPool2d(2, 2) # 13 -> 6
        
        self.dropout = nn.Dropout(0.5)
        
        self.conv6 = nn.Conv2d(32, 32, kernel_size=2, padding=0)
        self.pool6 = nn.MaxPool2d(2, 2) # 6 -> 2
        
        self.fc1 = nn.Linear(32 * 2 * 2, 50)
        self.fc2 = nn.Linear(50, 5)

    def forward(self, x):
        x = self.pool1(F.relu(self.conv1(x)))
        x = self.pool2(F.relu(self.conv2(x)))
        x = self.pool3(F.relu(self.conv3(x)))
        x = self.pool4(F.relu(self.conv4(x)))
        x = self.pool5(F.relu(self.conv5(x)))
        x = self.dropout(x)
        x = self.pool6(F.relu(self.conv6(x)))
        x = torch.flatten(x, 1)
        x = F.relu(self.fc1(x))
        x = self.fc2(x)
        return F.softmax(x, dim=1)

class ExamGuardInferenceEngine:
    def __init__(self, model_path=None):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model = PlaceholderCNN().to(self.device)
        self.model.eval()
        
        self.class_labels = {
            0: "Normal",
            1: "External Device",
            2: "Head Movement",
            3: "Multiple Persons",
            4: "Talking to Others"
        }

        if model_path:
            try:
                self.model.load_state_dict(torch.load(model_path, map_location=self.device))
                print(f"[INFERENCE] Loaded model weights from {model_path}")
            except Exception as e:
                print(f"[INFERENCE] Could not load model from {model_path}, using randomized weights: {e}")

    def analyze_frame(self, frame: np.ndarray) -> tuple[str, float, int]:
        """
        Takes a BGR frame (numpy array), preprocesses it to (1, 3, 224, 224),
        runs PyTorch model inference, and returns (label, confidence, class_id).
        """
        # Resize to 224x224
        resized = cv2.resize(frame, (224, 224))
        # Convert BGR to RGB
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        # Convert to tensor: HWC -> CHW, float32, normalize
        tensor = torch.from_numpy(rgb.transpose((2, 0, 1))).float() / 255.0
        # Add batch dimension
        tensor = tensor.unsqueeze(0).to(self.device)

        with torch.no_grad():
            outputs = self.model(tensor)
            probabilities = outputs[0].cpu().numpy()
            
        class_id = int(np.argmax(probabilities))
        confidence = float(probabilities[class_id])
        label = self.class_labels[class_id]

        # For demonstration purposes in testing, since randomized weights might output 
        # a single class consistently due to lack of training:
        # If we want to simulate other classes for robust frontend testing, we can
        # add a small random perturbation or alternate outputs if requested, 
        # but let's keep the model's authentic prediction while ensuring a valid range.
        return label, confidence, class_id
