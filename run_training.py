import os
from app.core.fine_tune import generate_mock_dataset, train_proctor_model

if __name__ == "__main__":
    dataset_dir = "dataset"
    data_yaml = os.path.join(dataset_dir, "data.yaml")
    
    # Check if dataset already exists, otherwise generate a mock one
    if not os.path.exists(data_yaml):
        print(f"[RUNNER] Dataset configuration '{data_yaml}' not found.")
        data_yaml = generate_mock_dataset(dataset_dir)
    else:
        print(f"[RUNNER] Using existing dataset configuration at: {data_yaml}")
        
    print("[RUNNER] Starting YOLOv8 fine-tuning process...")
    # Train for a small number of epochs (e.g. 3) to verify pipeline works
    train_proctor_model(data_yaml, epochs=3, imgsz=224)
